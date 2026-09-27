/**
 * Emulator ports. EMU_PORT_OFFSET (default 0) shifts every port so a second emulator suite, e.g. one
 * started from a second checkout, can run beside the usual one without the two sharing data.
 */
const offset = Number(process.env.EMU_PORT_OFFSET ?? 0) || 0;
export const EMU = {
  auth: 9099 + offset,
  functions: 5001 + offset,
  firestore: 8080 + offset,
  storage: 9199 + offset,
};
