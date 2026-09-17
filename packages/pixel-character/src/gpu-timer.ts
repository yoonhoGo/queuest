interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}
/** Asynchronous GPU queries only. No CPU render-duration substitution. */
export class GpuTimer {
  readonly extension: TimerExtension | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  latestMs: number | null = null;
  sampleId = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }
  begin() {
    const e = this.extension;
    if (!e || this.pending.length >= 8) return;
    const q = this.gl.createQuery();
    if (q) {
      this.active = q;
      this.gl.beginQuery(e.TIME_ELAPSED_EXT, q);
    }
  }
  end() {
    if (this.active && this.extension) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = null;
    }
  }
  poll() {
    const e = this.extension;
    if (!e) return;
    if (this.gl.getParameter(e.GPU_DISJOINT_EXT)) {
      for (const q of this.pending) this.gl.deleteQuery(q);
      this.pending = [];
      this.latestMs = null;
      return;
    }
    while (
      this.pending.length &&
      this.gl.getQueryParameter(this.pending[0], this.gl.QUERY_RESULT_AVAILABLE)
    ) {
      const q = this.pending.shift()!;
      this.latestMs = this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6;
      this.sampleId++;
      this.gl.deleteQuery(q);
    }
  }
  dispose() {
    this.end();
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending = [];
  }
}
