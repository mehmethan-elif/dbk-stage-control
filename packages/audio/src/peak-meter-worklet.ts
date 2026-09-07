export const PEAK_METER_PROCESSOR_NAME = "dbk-peak-meter";

/** Audio-thread peak hold so click transients are not missed between UI frames. */
export const PEAK_METER_PROCESSOR = `
class DbkPeakMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peaks = new Float32Array(12);
    this.holdUntil = new Float32Array(12);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const frames = input && input[0] ? input[0].length : 128;
    const decay = Math.exp(-frames / sampleRate / 0.05);
    const now = currentTime;
    const count = this.peaks.length;
    for (let c = 0; c < count; c++) {
      let blockPeak = 0;
      const data = input && input[c];
      if (data) {
        for (let i = 0; i < data.length; i++) {
          const sample = data[i];
          const mag = sample < 0 ? -sample : sample;
          if (mag > blockPeak) blockPeak = mag;
        }
      }
      if (blockPeak >= this.peaks[c]) {
        this.peaks[c] = blockPeak;
        this.holdUntil[c] = now + 0.04;
      } else if (now >= this.holdUntil[c]) {
        this.peaks[c] *= decay;
      }
    }
    const output = outputs[0];
    if (output) {
      for (let i = 0; i < output.length; i++) {
        if (output[i]) output[i].fill(0);
      }
    }
    this.port.postMessage(Array.from(this.peaks));
    return true;
  }
}

registerProcessor("${PEAK_METER_PROCESSOR_NAME}", DbkPeakMeterProcessor);
`;
