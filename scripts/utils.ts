import {Transform} from 'stream';

export class AsyncTransform<TInput, TOutput = TInput> extends Transform {
  private processChunk: (chunk: TInput) => Promise<TOutput>;

  constructor(processChunk: (chunk: TInput) => Promise<TOutput>) {
    super({objectMode: true});
    this.processChunk = processChunk;
  }

  async _transform(
    chunk: TInput,
    encoding: BufferEncoding,
    callback: () => void
  ) {
    this.push(await this.processChunk(chunk));
    callback();
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  on(event: 'close', listener: () => void): this;
  on(event: 'data', listener: (chunk: TOutput) => void): this;
  on(event: 'drain', listener: () => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'finish', listener: () => void): this;
  on(event: 'pause', listener: () => void): this;
  on(event: 'pipe', listener: (src: any) => void): this;
  on(event: 'readable', listener: () => void): this;
  on(event: 'resume', listener: () => void): this;
  on(event: 'unpipe', listener: (src: any) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
