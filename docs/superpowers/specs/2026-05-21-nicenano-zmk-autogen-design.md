# nice!nano ZMK Firmware Autogen — Design

Date: 2026-05-21

## Goal

Generate downloadable, buildable ZMK firmware for keyboards using a bare
**nice!nano / nRFMicro (nRF52840)** controller — not only Cosmos's own Lemon
Wireless board. The motivating build is "Cosmotyl": a wireless split with an
Azoteq PS65 (IQS550) trackpad.

## Background

Firmware autogen today is gated to Cosmos's own controllers in
`src/routes/beta/lib/editor/PeaConfig.svelte`: QMK for `lemon-wired`, ZMK for
`lemon-wireless`. The ZMK generator (`src/routes/beta/lib/firmware/zmk.ts`) is
hardwired to Lemon Wireless hardware:

- Board `cosmos_lemon_wireless` / `_v4` (custom board in the `rianadon/zmk` fork).
- Columns driven through a 595 shift register (`zmk,gpio-595` on `&spi1`).
- Rows on fixed nRF GPIO pins.
- VIK connector, WS2812 underglow chain, `ext_power_hog` — all in a
  board-specific `BOARD_OVERLAY`.
- Matrix transform hardcoded to `columns = 14, rows = 7`.

A bare nice!nano has none of that: no shift register, no VIK connector. Its key
matrix rows **and** columns connect directly to user-soldered GPIO, and
`nice_nano_v2` is an upstream ZMK board (no custom board file needed).

The logical matrix (`Matrix = Map<CuttleKey, [row, col]>`) is already built by
the user in `ViewerPea.svelte` and passed to the generators. What's missing is
the **physical pin** assignment and a generic, non-Lemon board path.

## Scope (v1)

In:
- Split (left/right with selectable central side) **and** unibody.
- Key matrix with auto-assigned default pins.
- Azoteq IQS5xx-family trackpad (IQS550 / PS65) over I2C — **mandatory**.

Out (deferred):
- RGB underglow, encoders, PMW3610/Cirque pointing on nice!nano.
- User-editable pin assignment UI (auto-assign only; pins documented in output).
- IQS7211E / Procyon (different chip; not the user's hardware).

## Architecture: board-profile seam in `zmk.ts`

Refactor `zmk.ts` (Approach A — chosen over a parallel module to avoid
duplicating keymap/layout/keycode logic). Extract Lemon-specific behavior behind
a small profile interface; everything else stays shared.

```ts
interface ZMKBoard {
  /** Devicetree board id used in build.yaml. */
  boardId(options: ZMKOptions): string
  /** Lemon's BOARD_OVERLAY content; undefined when the board is upstream. */
  customBoardOverlay?(config: FullGeometry, options: ZMKOptions): string | undefined
  /** The kscan0 node object passed to dtsFile (matrix-gpio vs 595 shifter). */
  kscanNode(config: FullGeometry, matrix: Matrix, options: ZMKOptions): object
  /** Board-specific lines appended to <shield>.conf. */
  confLines(config: FullGeometry, options: ZMKOptions): string[]
  /** west.yml `projects` (and any extra remotes). */
  westProjects(config: FullGeometry): { remotes: object[]; projects: object[] }
  /** zephyr/module.yml `build.depends`. */
  moduleDepends(): string[]
}
```

Implementations:
- `lemonWirelessBoard` — existing behavior moved verbatim (595 shifter kscan,
  VIK SPI, `ext_power_hog`, `vik-core` depends, `BOARD_OVERLAY`).
- `niceNanoBoard` — described below.

`downloadZMKCode` selects the profile from `options.board` and:
- omits the `boards/<board>.overlay` file when `customBoardOverlay` returns
  undefined,
- uses `kscanNode`, `confLines`, `westProjects`, `moduleDepends` from the
  profile.

Two existing hardcodes become generic (correctness win for both boards):
- **Matrix transform dims**: `columns`/`rows` computed from the matrix Map
  (`max col + 1`, `max row + 1`) instead of `14`/`7`.
- **Split `colOffset`** in `generateOverlay`: derived from the left side's
  column count instead of the literal `7`.

Shared, unchanged: `generateKeymap`, `generateKeycodes`, `generateLayouts`,
`generateZMKYaml`, `generateDefconfig`, `generateShield`, `generateGitHubWorkflow`.

## nice!nano board profile

### kscan — direct GPIO matrix

`zmk,kscan-gpio-matrix` with both `rowGpios` and `colGpios` referencing the
board's `&pro_micro` GPIO nexus (the standard pro-micro-footprint idiom),
avoiding a fragile raw `&gpio0/&gpio1` port/pin table:

```
kscan0: kscan_0 {
    compatible = "zmk,kscan-gpio-matrix";
    diode-direction = "row2col";   // FROM options.diodeDirection (see note)
    row-gpios = <&pro_micro N (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)> , ... ;
    col-gpios = <&pro_micro M GPIO_ACTIVE_HIGH> , ... ;
};
```

`activeMode`/`pullMode` follow the existing diode-direction logic in
`generateDTSI`. **Bug to fix:** the current Lemon `generateDTSI` emits a literal
`diode-direction = "col2row"` regardless of `options.diodeDirection` (only the
active/pull flags flip). The nice!nano kscan must set `diode-direction` from
`options.diodeDirection` (lowercased). Decide during implementation whether to
also correct the Lemon path or scope the fix to nice!nano only.

### Pin map (confirmed)

`&pro_micro <N>` maps directly to nice!nano label `D<N>`, per the fork's
`app/boards/arm/nice_nano/arduino_pro_micro_pins.dtsi`. Usable indices:

```
NICENANO_PIN_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 18, 19, 20, 21]
```

(matches Cosmos's usable `D`-pin list; 11/12/13/17 absent). Matrix row/col GPIO
reference these as `<&pro_micro N ...>` — no raw `&gpio0/1` port/pin table needed.

### Pin assignment (auto)

Assignment order, sliced to the matrix's actual counts:
1. If a trackpad is present, **I2C SDA/SCL are fixed to the board's
   `pro_micro_i2c` default pins** (not drawn from the pool — see trackpad
   section) and only **reset + rdy (2 pins)** are reserved from the pool.
2. Rows = next `rowCount` pins from `NICENANO_PIN_ORDER`.
3. Columns = next `colCount` pins.

The chosen assignment is emitted as a comment block in the generated `.dtsi` and
documented in the firmware docs, so the user knows where to solder. For split,
both halves use the same per-side assignment; the right half's columns are
shifted by the matrix transform `colOffset` — **but see the split-encoding
verification gate below before trusting that offset.**

### conf

```
CONFIG_ZMK_SLEEP=y          // sensible wireless defaults
# trackpad (when present)
CONFIG_I2C=y
CONFIG_INPUT=y
CONFIG_INPUT_AZOTEQ_IQS5XX=y
CONFIG_ZMK_POINTING=y
```

No SPI / WS2812 / EC11 lines (those are Lemon/peripheral-specific and out of v1
scope).

## Azoteq IQS5xx trackpad integration

Driver: `github.com/AYM1607/zmk-driver-azoteq-iqs5xx` (community module; tested
on TPS43 and TPS65 — same IQS5xx family as the PS65/IQS550). Devicetree
`compatible = "azoteq,iqs5xx"`, I2C address `0x74`, requires `reset-gpios` and
`rdy-gpios`.

**west.yml** gains:
```yaml
remotes:
  - name: aym1607
    url-base: https://github.com/AYM1607
projects:
  - name: zmk-driver-azoteq-iqs5xx
    remote: aym1607
    revision: main      # pin to a specific SHA during implementation
```

**Shield overlay** (on the side that carries the trackpad) adds an input
listener + the trackpad node on the board's I2C bus. The reference dev shield
uses the DK's `arduino_i2c` / `arduino_header`, which nice!nano lacks. Instead
use the board's `pro_micro_i2c` alias (`= &i2c0`, defined in
`arduino_pro_micro_pins.dtsi`): its SDA/SCL pinctrl defaults are already set by
the board, so **no custom pinctrl block is needed**. The user solders SDA/SCL to
those default pins (verify exact pins in `nice_nano-pinctrl.dtsi` during impl;
they are documented + emitted as a comment). `reset-gpios`/`rdy-gpios` are plain
GPIO and use the `&pro_micro` nexus (2 pins reserved from the pool):

```
trackpad_input: trackpad_input {
    compatible = "zmk,input-listener";
    device = <&trackpad>;
};

&pro_micro_i2c {           // = &i2c0; SDA/SCL on board-default pinctrl pins
    status = "okay";
    trackpad: iqs5xx@74 {
        compatible = "azoteq,iqs5xx";
        reg = <0x74>;
        reset-gpios = <&pro_micro R GPIO_ACTIVE_LOW>;   // R from pin pool
        rdy-gpios   = <&pro_micro Y GPIO_ACTIVE_HIGH>;   // Y from pin pool
        one-finger-tap;
        press-and-hold;
        two-finger-tap;
        scroll;
        bottom-beta = <5>;
        stationary-threshold = <5>;
    };
};
```

`zephyr/module.yml` and the conf flags above complete the wiring. The trackpad
attaches to the side whose Cosmos config contains a `trackpad-azoteq` key; for
split, only that side's overlay/conf gets the node.

**Split constraint (v1):** a pointing device on the *peripheral* half requires
ZMK split input forwarding over BLE, which the reference shields don't exercise.
For v1, **require the trackpad half to be the central side** and surface this in
the UI / errors (`zmkErrors`) when the config puts the trackpad on the
non-central half. Peripheral-side pointing relay is a follow-up.

**Honesty note:** built firmware cannot be compiled or flashed inside this repo.
Verification is limited to structural correctness (valid DTS/YAML, expected
nodes/flags, matching the driver README's documented schema). Whether it runs on
the exact PS65 is for the user to flash and confirm.

## UI changes

`PeaConfig.svelte`: add a block for
`anyConfig.microcontroller == 'nrfmicro-or-nicenano'`, mirroring the
`lemon-wireless` block but:
- keep: diode direction, central side, ZMK Studio, USB logging,
  "Download ZMK code".
- drop: wireless version select, RGB toggle.
- call `downloadZMKCode(geometry, matrix, { ...fullOptions, board: 'nicenano' })`.

`zmk.ts` `ZMKOptions`: add `board: 'lemon-wireless' | 'nicenano'`.
`ZMKPeripherals`: add `azoteq: boolean`.
`PeaConfig.svelte` peripheral auto-detect: add
`azoteq: c.keys.some(k => k.type == 'trackpad-azoteq')`.
`boardName()` (renamed/kept) switches on `options.board`.

## File outputs (zip) for nice!nano

Same layout as Lemon, minus the custom board overlay:
```
<folder>/
  .github/workflows/build.yml      (shared)
  build.yaml                       (board: nice_nano_v2)
  zephyr/module.yml                (depends: profile)
  config/deps.yml, config/west.yml (azoteq driver)
  boards/shields/<folder>/
    Kconfig.defconfig, Kconfig.shield   (shared)
    <folder>.dtsi                  (matrix kscan + pin comment + i2c/trackpad)
    <folder>-layouts.dtsi          (shared)
    <folder>.keymap                (shared)
    <folder>.zmk.yml               (shared)
    <folder>_left/right(.overlay/.conf)  or unibody variants
```

## Split matrix-encoding verification gate (do first)

The matrix `Map<CuttleKey,[row,col]>` is built by manual user entry in
`ViewerPea.svelte` (`:70`) with **no automatic column offset**. Lemon hardcodes
`columns=14, rows=7` and a right-side `col-offset=7`; `isBootmagic` (`:94`)
accepts right `(0,0)` for ZMK, which hints right columns may be entered *local*
(0-based per side). If right columns are local, the shared `default_transform`
map would have colliding `RC(r,c)` entries between halves — so either the map is
generated with the offset baked in, or right entries are actually global.

**Resolve this before writing the generic dim/offset logic.** Concrete experiment:
generate a real Lemon **split** ZMK zip from a known config, open
`<folder>.dtsi` + `<folder>_right.overlay`, and trace one right-side key from its
matrix value → transform `map` entry → `col-offset` → bindings index. Document
whether values are local or global. Then:
- if **global**: `columns = max(col)+1`, no per-side offset in the map; the right
  overlay `col-offset` stays as a no-op or is dropped.
- if **local**: derive `columns = leftCols + rightCols`, keep `col-offset =
  leftCols`, and the map must add the offset for right keys.

Getting this wrong yields a keyboard whose right half types the wrong keys, so it
gates the dim-derivation work in step 2 below.

## Verification

1. **Snapshot test first**: capture current Lemon ZMK output into a `bun:test`
   snapshot (alongside `firmwareHelpers.test.ts`) **before** refactoring, to
   catch regressions in the extract-to-profile step.
2. **nice!nano tests**: small split + unibody fixtures →
   - `kscan-gpio-matrix` present, `&pro_micro` refs for rows and cols,
   - `diode-direction` reflects `options.diodeDirection` (not hardcoded),
   - matrix transform dims derived correctly (per the encoding gate above),
   - no `zmk,gpio-595` / VIK / `cosmos_lemon_wireless`,
   - `board: nice_nano_v2` in build.yaml,
   - trackpad fixture → `pro_micro_i2c` `iqs5xx@74` node, input listener,
     reset/rdy on `&pro_micro`, conf flags, azoteq west project,
   - trackpad-on-peripheral fixture → `zmkErrors` warns to make that side central.
3. `npm run check` (svelte-check + tsc).
4. Manual: download a zip for the Cosmotyl config, eyeball file structure.

## Open items resolved during implementation

- Split column encoding (local vs global) — **the gate above; do first.**
- Exact `pro_micro_i2c` default SDA/SCL pins (read `nice_nano-pinctrl.dtsi`) to
  document for soldering.
- Pin the azoteq driver to a specific revision SHA rather than `main`.
- Whether to also fix the Lemon `diode-direction` hardcode or scope it to
  nice!nano.

## Build sequence

1. **Verify split column encoding** (gate above) + snapshot-lock current Lemon
   ZMK output (test).
2. Introduce `ZMKBoard` interface; extract `lemonWirelessBoard`; make transform
   dims + split colOffset generic per the verified encoding. Snapshot stays green.
3. Implement `niceNanoBoard` matrix kscan (`&pro_micro` pins, diode-direction
   from options) + pin assignment + conf.
4. Add `board` to `ZMKOptions`, `azoteq` to `ZMKPeripherals`; wire `PeaConfig`
   UI block + peripheral detection + central-side-trackpad check.
5. Add azoteq west/deps + `pro_micro_i2c` trackpad overlay generation.
6. nice!nano tests; `npm run check`; manual zip inspection.
