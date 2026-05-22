import type { CuttleKey } from '$lib/worker/config'
import { expect, test } from 'bun:test'
import { defaultMatrix, dtsFile, logicalKeys, raw, yamlFile } from './firmwareHelpers'

const k = (cluster: string, row: number, column: number) =>
  ({
    type: 'mx-better',
    cluster,
    position: { history: [{ name: 'placeOnMatrix', args: [{ row, column }] }] },
  }) as unknown as CuttleKey

test('Example DTS', () => {
  const json = {
    [raw()]: '#include <behaviors.dtsi>',
    [raw()]: '#include <dt-bindings/zmk/matrix_transform.h>',
    [raw()]: '#include <dt-bindings/zmk/keys.h>',
    [raw()]: '// Tell VIK that there is 1 other device on the SPI bus.',
    [raw()]: '// You will need to increase this number if you add another SPI device.',
    [raw()]: '#define VIK_SPI_REG_START 1',
    [raw()]: '// Pulled out to an external variable so VIK can find the SPI bus.',
    [raw()]: '#define VIK_SPI_CS_PREFIX <&gpio0 4 GPIO_ACTIVE_LOW>',
    '&spi1': {
      status: 'okay',
      csGpios: ['VIK_SPI_CS_PREFIX'],
      'shifter: 595@0': {
        compatible: 'zmk,gpio-595',
        status: 'okay',
        gpioController: true,
        spiMaxFrequency: 200000,
        reg: 0,
        ngpios: 8,
        '#gpio-cells': 2,
      },
    },
    '/': {
      'chosen': {
        'zmk,kscan': '&kscan0',
        'zmk,matrix_transform': '&default_transform',
      },
      'default_transform: keymap_transform_0': {
        compatible: 'zmk,matrix-transform',
        columns: 14,
        rows: 7,
      },
      'kscan0: kscan_0': {
        compatible: 'zmk,kscan-gpio-matrix',
        diodeDirection: 'col2row',
        rowGpios: [
          '<&gpio0 20 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>',
          '<&gpio0 22 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>',
          '<&gpio0 24 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>',
          '<&gpio0 9  (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>',
          '<&gpio0 10 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>',
          '<&gpio1 13 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>',
          '<&gpio1 15 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>',
        ],
        colGpios: [
          '<&shifter 0 GPIO_ACTIVE_HIGH>',
          '<&shifter 1 GPIO_ACTIVE_HIGH>',
          '<&shifter 2 GPIO_ACTIVE_HIGH>',
          '<&shifter 3 GPIO_ACTIVE_HIGH>',
          '<&shifter 4 GPIO_ACTIVE_HIGH>',
          '<&shifter 5 GPIO_ACTIVE_HIGH>',
          '<&shifter 6 GPIO_ACTIVE_HIGH>',
        ],
      },
    },
  }

  const output = `#include <behaviors.dtsi>
#include <dt-bindings/zmk/matrix_transform.h>
#include <dt-bindings/zmk/keys.h>

// Tell VIK that there is 1 other device on the SPI bus.
// You will need to increase this number if you add another SPI device.
#define VIK_SPI_REG_START 1
// Pulled out to an external variable so VIK can find the SPI bus.
#define VIK_SPI_CS_PREFIX <&gpio0 4 GPIO_ACTIVE_LOW>

&spi1 {
    status = "okay";
    cs-gpios = VIK_SPI_CS_PREFIX;

    shifter: 595@0 {
        compatible = "zmk,gpio-595";
        status = "okay";
        gpio-controller;
        spi-max-frequency = <200000>;
        reg = <0>;
        ngpios = <8>;
        #gpio-cells = <2>;
    };
};

/ {
    chosen {
        zmk,kscan = &kscan0;
        zmk,matrix_transform = &default_transform;
    };

    default_transform: keymap_transform_0 {
        compatible = "zmk,matrix-transform";
        columns = <14>;
        rows = <7>;
    };

    kscan0: kscan_0 {
        compatible = "zmk,kscan-gpio-matrix";
        diode-direction = "col2row";

        row-gpios
            = <&gpio0 20 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>
            , <&gpio0 22 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>
            , <&gpio0 24 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>
            , <&gpio0 9  (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>
            , <&gpio0 10 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>
            , <&gpio1 13 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>
            , <&gpio1 15 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>
            ;

        col-gpios
            = <&shifter 0 GPIO_ACTIVE_HIGH>
            , <&shifter 1 GPIO_ACTIVE_HIGH>
            , <&shifter 2 GPIO_ACTIVE_HIGH>
            , <&shifter 3 GPIO_ACTIVE_HIGH>
            , <&shifter 4 GPIO_ACTIVE_HIGH>
            , <&shifter 5 GPIO_ACTIVE_HIGH>
            , <&shifter 6 GPIO_ACTIVE_HIGH>
            ;
    };
};
`
  expect(dtsFile(json)).toEqual(output)
})

test('Overlay generation', () => {
  const overlayFn = (right: boolean) => {
    let overlay = `#include "folder.dtsi"

/ {
    bootloader_key: bootloader_key {
        compatible = "zmk,boot-magic-key";
        key-position = <6>;
        jump-to-bootloader;
    };
};
`
    if (right) {
      overlay += `
&default_transform {
    col-offset = <7>;
};
`
    }
    return overlay
  }
  const overlayFn2 = (right: boolean) =>
    dtsFile({
      [raw()]: '#include "folder.dtsi"',
      '/': {
        'bootloader_key: bootloader_key': {
          compatible: 'zmk,boot-magic-key',
          keyPosition: 6,
          jumpToBootloader: true,
        },
      },
      '&default_transform': right && {
        colOffset: 7,
      },
    })

  expect(overlayFn2(false)).toBe(overlayFn(false))
  expect(overlayFn2(true)).toBe(overlayFn(true))
})

test('defaultMatrix: split numbers right columns past the left half', () => {
  const l00 = k('fingers', 0, 0), l01 = k('fingers', 0, 1), l10 = k('fingers', 1, 0), l11 = k('fingers', 1, 1)
  const r00 = k('fingers', 0, 0), r01 = k('fingers', 0, 1), r10 = k('fingers', 1, 0), r11 = k('fingers', 1, 1)
  const geo = {
    left: { c: { keys: [l00, l01, l10, l11] } },
    right: { c: { keys: [r00, r01, r10, r11] } },
  } as any
  const m = defaultMatrix(geo)
  // Left occupies columns 0,1; right continues at 2,3 (so col-offset 2 = left column count).
  expect(m.get(l00)).toEqual([0, 0])
  expect(m.get(l11)).toEqual([1, 1])
  expect(m.get(r00)).toEqual([0, 2])
  expect(m.get(r11)).toEqual([1, 3])
  // Every (row, col) is unique across the whole keyboard.
  const seen = new Set(Array.from(m.values()).map(([r, c]) => `${r},${c}`))
  expect(seen.size).toBe(8)
})

test('defaultMatrix: a thumb key sharing a column packs into an extra row', () => {
  const top = k('fingers', 0, 0), bot = k('fingers', 1, 0)
  const thumb = k('thumbs', 5, 0) // far-down layout row, same column value
  const geo = { unibody: { c: { keys: [top, bot, thumb] } } } as any
  const m = defaultMatrix(geo)
  expect(m.get(top)).toEqual([0, 0])
  expect(m.get(bot)).toEqual([1, 0])
  expect(m.get(thumb)).toEqual([2, 0]) // packed as the third row of column 0
})

test('defaultMatrix: insertion order matches logicalKeys', () => {
  const l0 = k('fingers', 0, 0), l1 = k('fingers', 1, 0)
  const r0 = k('fingers', 0, 0), r1 = k('fingers', 1, 0)
  const geo = { left: { c: { keys: [l0, l1] } }, right: { c: { keys: [r0, r1] } } } as any
  const m = defaultMatrix(geo)
  expect(Array.from(m.keys())).toEqual(logicalKeys(geo))
})

test('Example YAML file', () => {
  const yaml = {
    include: [
      {
        board: 'cosmos_lemon_wireless',
        shield: 'kb_left',
        snippet: 'zmk-usb-logging;studio-rpc-usb-uart',
        'cmake-args': '-DCONFIG_ZMK_STUDIO=y',
      },
      {
        board: 'cosmos_lemon_wireless',
        shield: 'kb_right',
        snippet: undefined,
        'cmake-args': undefined,
      },
    ],
  }

  const output = `---
include:
  - board: cosmos_lemon_wireless
    shield: kb_left
    snippet: zmk-usb-logging;studio-rpc-usb-uart
    cmake-args: -DCONFIG_ZMK_STUDIO=y
  - board: cosmos_lemon_wireless
    shield: kb_right
`

  expect(yamlFile(yaml, true)).toEqual(output)
})
