SECTION "Entry", ROM0[$0100]
  jp Boot

SECTION "Program", ROM0[$0150]
Boot:
  di
  ld sp, $fffe
  call StopLcd
  ld a, $0a
  ld [$0000], a
  xor a
  ld [$4000], a
  ld a, [$a000]
  cp $ff
  jr nz, .saveReady
  ld a, 1
  ld [$a000], a
.saveReady:
  ld a, $80
  ldh [$ff68], a
  ld hl, Palette
  ld b, 8
.palette:
  ld a, [hli]
  ldh [$ff69], a
  dec b
  jr nz, .palette
  ld a, $e4
  ldh [$ff47], a
  ld hl, $9800
  ld bc, $0400
.tileMap:
  xor a
  ld [hli], a
  dec bc
  ld a, b
  or c
  jr nz, .tileMap
  call Paint
  ld a, $10
  ldh [$ff00], a
.press:
  ldh a, [$ff00]
  bit 0, a
  jr nz, .press
  ld a, [$a000]
  inc a
  ld [$a000], a
  call Paint
.release:
  ldh a, [$ff00]
  bit 0, a
  jr z, .release
  jr .press

StopLcd:
  ldh a, [$ff40]
  bit 7, a
  jr z, .stop
.vblank:
  ldh a, [$ff44]
  cp 144
  jr c, .vblank
.stop:
  xor a
  ldh [$ff40], a
  ret

Paint:
  call StopLcd
  ld a, [$a000]
  and 1
  ld d, $00
  jr z, .pattern
  ld d, $aa
.pattern:
  ld hl, $8000
  ld b, 16
.pixel:
  ld a, d
  ld [hli], a
  dec b
  jr nz, .pixel
  ld a, $91
  ldh [$ff40], a
  ret

Palette:
  db $ff, $7f, $00, $00, $ff, $7f, $00, $00
