// Validate the exact relaxed integer-dot instruction before selecting that binary.
// Keep both operands in its portable domain: signed i8 and unsigned 0..127.
export function supportsRelaxedSIMD(): boolean {
  try {
    const vector = (value: number) => [0xfd, 0x0c, ...Array<number>(16).fill(value)];
    const body = [
      0,
      ...vector(1),
      ...vector(127),
      ...vector(0),
      0xfd,
      0x93,
      0x02, // i32x4.relaxed_dot_i8x16_i7x16_add_s
      0xfd,
      0x1b,
      0, // i32x4.extract_lane 0
      0x0b,
    ];
    const code = [1, body.length, ...body];
    return WebAssembly.validate(
      new Uint8Array([
        0,
        97,
        115,
        109,
        1,
        0,
        0,
        0,
        1,
        5,
        1,
        0x60,
        0,
        1,
        0x7f,
        3,
        2,
        1,
        0,
        10,
        code.length,
        ...code,
      ]),
    );
  } catch {
    return false;
  }
}
