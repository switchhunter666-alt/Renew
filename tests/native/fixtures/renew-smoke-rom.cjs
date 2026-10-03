'use strict';

// Original, logo-free GBA fixture. No BIOS, copyrighted header logo, library,
// commercial game, assembler or downloaded ROM is used. Not a hardware boot ROM.
// Mode 4 displays palette entry 0: red, green, blue, changing every 30 VBlanks.
function makeSmokeRom() {
  const rom = Buffer.alloc(1024);
  rom.writeUInt32LE(0xea00002e, 0); // b 0x080000c0
  rom.write('RENEW SMOKE', 0xa0, 'ascii');
  rom.write('RNWT00', 0xac, 'ascii');
  rom[0xb2] = 0x96;
  let checksum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= rom[i];
  rom[0xbd] = (checksum - 0x19) & 255;

  const words = [], labels = new Map(), patches = [];
  const emit = word => words.push(word >>> 0);
  const label = name => labels.set(name, words.length);
  const branch = (name, condition = 0xe) => {
    patches.push({ at: words.length, name, condition }); emit(0);
  };
  const literal = (register, value) => {
    patches.push({ at: words.length, register, value }); emit(0);
  };
  literal(0, 0x04000000); // r0 = display registers
  literal(1, 0x00000404); // mode 4, BG2 enabled
  emit(0xe1c010b0); // strh r1,[r0]
  literal(2, 0x06000000); // r2 = video RAM
  emit(0xe3a03000); // mov r3,#0
  literal(4, 19200); // 240*160 bytes / two bytes per store
  label('clear');
  emit(0xe0c230b2); // strh r3,[r2],#2
  emit(0xe2544001); // subs r4,r4,#1
  branch('clear', 0x1); // bne
  literal(2, 0x05000000); // palette RAM
  emit(0xe3a0301f); // red in RGB555
  label('color');
  emit(0xe1c230b0); // strh r3,[r2]
  emit(0xe3a0401e); // 30 frames per color
  label('visible');
  emit(0xe1d050b6); // ldrh r5,[r0,#6] (VCOUNT)
  emit(0xe35500a0); // cmp r5,#160
  branch('visible', 0xa); // bge: wait until outside VBlank
  label('vblank');
  emit(0xe1d050b6);
  emit(0xe35500a0);
  branch('vblank', 0xb); // blt: wait until VBlank starts
  emit(0xe2544001);
  branch('visible', 0x1);
  emit(0xe1a03283); // mov r3,r3,lsl #5: red -> green -> blue
  emit(0xe3530902); // cmp r3,#0x8000
  emit(0xa3a0301f); // movge r3,#31: blue -> red
  branch('color');
  for (const patch of patches) {
    if (patch.name) {
      words[patch.at] = ((patch.condition << 28) | 0x0a000000 |
        ((labels.get(patch.name) - patch.at - 2) & 0x00ffffff)) >>> 0;
    } else {
      const offset = (words.length - patch.at - 2) * 4;
      words[patch.at] = (0xe59f0000 | patch.register << 12 | offset) >>> 0;
      emit(patch.value);
    }
  }
  words.forEach((word, i) => rom.writeUInt32LE(word, 0xc0 + i * 4));
  return rom;
}

module.exports = { makeSmokeRom };
