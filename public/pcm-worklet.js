// AudioWorklet processor: converts Float32 audio to little-endian Int16 PCM and
// posts it to the main thread in ~128ms frames. One instance per channel
// ("me" = mic, "them" = meeting tab), tagged via processorOptions.channel.
//
// The AudioContext is created at 16 kHz, so the browser resamples the source to
// 16 kHz before it reaches us — no resampling needed here.
class PCMWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channel = (options.processorOptions && options.processorOptions.channel) || "me";
    this.frame = 2048; // samples per post (~128ms at 16kHz)
    this.buf = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      const incoming = input[0];
      const merged = new Float32Array(this.buf.length + incoming.length);
      merged.set(this.buf);
      merged.set(incoming, this.buf.length);
      this.buf = merged;

      while (this.buf.length >= this.frame) {
        const pcm = new Int16Array(this.frame);
        for (let i = 0; i < this.frame; i++) {
          let s = this.buf[i];
          if (s > 1) s = 1;
          else if (s < -1) s = -1;
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage({ channel: this.channel, pcm: pcm.buffer }, [pcm.buffer]);
        this.buf = this.buf.slice(this.frame);
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
