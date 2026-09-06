.syntax unified
.cpu arm7tdmi
.arm
.text
.global _start
_start:
  b boot
  .org 0xc0
boot:
  mov r0, #0x04000000
  mov r1, #0x400
  orr r1, r1, #3
  strh r1, [r0]
  mov r5, #0x0e000000
  ldrb r4, [r5]
  cmp r4, #0xff
  moveq r4, #1
  strbeq r4, [r5]
  ldr r6, =0x04000130
  bl paint
wait_press:
  ldrh r7, [r6]
  tst r7, #1
  bne wait_press
  add r4, r4, #1
  and r4, r4, #31
  strb r4, [r5]
  bl paint
wait_release:
  ldrh r7, [r6]
  tst r7, #1
  beq wait_release
  b wait_press
paint:
  tst r4, #1
  movne r0, #0x1f
  moveq r0, #0x3e0
  mov r1, #0x06000000
  mov r2, #0x9600
fill:
  strh r0, [r1], #2
  subs r2, r2, #1
  bne fill
  bx lr
  .ltorg
  .org 0x400
  .ascii "SRAM_V110"
