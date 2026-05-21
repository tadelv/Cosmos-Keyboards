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
    diode-direction = "col2row";   // or row2col per options
    row-gpios = <&pro_micro N (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)> , ... ;
    col-gpios = <&pro_micro M GPIO_ACTIVE_HIGH> , ... ;
};
```

`activeMode`/`pullMode` follow the existing diode-direction logic in
`generateDTSI`.

### Pin assignment (auto)

A fixed ordered list of usable Cosmos nice!nano pin labels mapped to
`&pro_micro` indices:

```
NICENANO_PIN_ORDER = [D0, D1, D2, D3, D4, D5, D6, D7, D8, D9,
                      D10, D14, D15, D16, D18, D19, D20, D21]
```

Assignment order, sliced to the matrix's actual counts:
1. If a trackpad is present, reserve I2C SDA/SCL + reset + rdy (4 pins) first.
2. Rows = next `rowCount` pins.
3. Columns = next `colCount` pins.

The exact label→pro_micro index numbers are verified during implementation
against ZMK's `nice_nano_v2.dts` + `arduino_pro_micro` connector. The chosen
assignment is emitted as a comment block in the generated `.dtsi` and documented
in the firmware docs, so the user knows where to solder. For split, both halves
use the same per-side assignment; the right half's columns are shifted by the
matrix transform `colOffset`.

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

**Shield overlay** (on the side that carries the trackpad) adds an I2C node +
input listener. Unlike the reference dev shield (which uses the DK's
`arduino_i2c` / `arduino_header`), nice!nano has no arduino headers, so we define
an I2C bus on reserved pro_micro pins and reference them for reset/rdy:

```
trackpad_input: trackpad_input {
    compatible = "zmk,input-listener";
    device = <&trackpad>;
};

&pro_micro_i2c {           // or an i2c node bound to the reserved SDA/SCL pins
    status = "okay";
    trackpad: iqs5xx@74 {
        compatible = "azoteq,iqs5xx";
        reg = <0x74>;
        reset-gpios = <&pro_micro R GPIO_ACTIVE_LOW>;
        rdy-gpios   = <&pro_micro Y GPIO_ACTIVE_HIGH>;
        one-finger-tap;
        press-and-hold;
        two-finger-tap;
        scroll;
        bottom-beta = <5>;
        stationary-threshold = <5>;
    };
};
```

`zephyr/module.yml` `build.depends` and the conf flags above complete the wiring.
The trackpad is attached to the side whose Cosmos config contains a
`trackpad-azoteq` key; for split, only that side's overlay/conf gets the node.

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

## Verification

1. **Snapshot test first**: capture current Lemon ZMK output into a `bun:test`
   snapshot (alongside `firmwareHelpers.test.ts`) **before** refactoring, to
   catch regressions in the extract-to-profile step.
2. **nice!nano tests**: small split + unibody fixtures →
   - `kscan-gpio-matrix` present, `&pro_micro` refs for rows and cols,
   - matrix transform dims derived correctly,
   - no `zmk,gpio-595` / VIK / `cosmos_lemon_wireless`,
   - `board: nice_nano_v2` in build.yaml,
   - trackpad fixture → `iqs5xx@74` node, input listener, conf flags, west project.
3. `npm run check` (svelte-check + tsc).
4. Manual: download a zip for the Cosmotyl config, eyeball file structure.

## Open items resolved during implementation

- Exact Cosmos D-label → `&pro_micro` index map (verify vs `nice_nano_v2.dts`).
- Whether to use a predefined `&pro_micro_i2c` alias or define an i2c node on
  reserved pins.
- Pin the azoteq driver to a specific revision SHA rather than `main`.

## Build sequence

1. Snapshot-lock current Lemon ZMK output (test).
2. Introduce `ZMKBoard` interface; extract `lemonWirelessBoard`; make transform
   dims + split colOffset generic. Snapshot must stay green.
3. Implement `niceNanoBoard` matrix kscan + pin assignment + conf.
4. Add `board` to `ZMKOptions`, `azoteq` to `ZMKPeripherals`; wire `PeaConfig`
   UI block + peripheral detection.
5. Add azoteq west/deps + trackpad overlay generation.
6. nice!nano tests; `npm run check`; manual zip inspection.
