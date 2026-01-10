declare module "mammoth/mammoth.browser" {
  export type ExtractResult = {
    value: string;
    messages: Array<{ type: string; message: string }>;
  };

  export function extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<ExtractResult>;
}
