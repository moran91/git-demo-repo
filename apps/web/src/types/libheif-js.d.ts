declare module 'libheif-js/wasm-bundle' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(target: ImageData, cb: (result: ImageData | null) => void): void;
    free(): void;
  }
  export class HeifDecoder {
    /** Returns every image in the container; empty (never throws) on a file libheif cannot parse. */
    decode(data: ArrayBuffer | Uint8Array): HeifImage[];
  }
  const libheif: { HeifDecoder: typeof HeifDecoder };
  export default libheif;
}
