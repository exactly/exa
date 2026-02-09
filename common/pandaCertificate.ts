import domain from "./domain";

const production = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCeZ9uCoxi2XvOw1VmvVLo88TLk
GE+OO1j3fa8HhYlJZZ7CCIAsaCorrU+ZpD5PUTnmME3DJk+JyY1BB3p8XI+C5uno
QucrbxFbkM1lgR10ewz/LcuhleG0mrXL/bzUZbeJqI6v3c9bXvLPKlsordPanYBG
FZkmBPxc8QEdRgH4awIDAQAB
-----END PUBLIC KEY-----`;

const sandbox = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- ignore empty string */
export default process.env.EXPO_PUBLIC_PANDA_PUBLIC_KEY ||
  {
    "web.exactly.app": production,
    "base.exactly.app": production,
    "base-sepolia.exactly.app": sandbox,
    "sandbox.exactly.app": sandbox,
  }[domain] ||
  `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCu2YOeObkaYiQmc49t2Cnk8syA
1UBqFBMVhkJXyuSA9f+hGC22fXgQtpfAjQmFRpt5q4f6i0rG2bUi8Km0jZELdD6X
Kz63/hp522fbxNuOOxs37dlH9B3k6W8NQjjDjaFhAwCsevq7uASXwEEK3NpV7DEP
lJe6c8CQ0+QqTTy2ZwIDAQAB
-----END PUBLIC KEY-----`;
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
