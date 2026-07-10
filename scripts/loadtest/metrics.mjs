// Gecikme/hata metrikleri: RPC bazında latency örnekleri, hata sayaçları,
// olay sayaçları; özet tablo + JSON rapor.
import { writeFileSync, mkdirSync } from 'node:fs';

export class Metrics {
  constructor() {
    this.samples = new Map(); // ad → number[] (ms)
    this.errors = new Map(); // kod → adet
    this.counters = new Map(); // ad → adet
    this.startedAt = Date.now();
  }

  record(name, ms) {
    if (!this.samples.has(name)) this.samples.set(name, []);
    this.samples.get(name).push(ms);
  }

  countError(code) {
    this.errors.set(code, (this.errors.get(code) ?? 0) + 1);
  }

  incr(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  /** Bir async çağrıyı ölçüp adına yazar; hata olursa kodunu sayar ve fırlatır. */
  async time(name, fn) {
    const t0 = Date.now();
    try {
      const r = await fn();
      this.record(name, Date.now() - t0);
      return r;
    } catch (e) {
      this.record(name, Date.now() - t0);
      this.countError(e?.code ?? e?.message ?? 'unknown');
      throw e;
    }
  }

  static pct(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
    return s[idx];
  }

  summaryRows() {
    const rows = [];
    for (const [name, arr] of [...this.samples.entries()].sort()) {
      rows.push({
        rpc: name,
        n: arr.length,
        p50: Metrics.pct(arr, 50),
        p95: Metrics.pct(arr, 95),
        p99: Metrics.pct(arr, 99),
        max: Math.max(...arr),
      });
    }
    return rows;
  }

  printSummary(log = console.log) {
    const durSec = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    log('');
    log(`── RPC gecikmesi (ms) ─ toplam süre ${durSec}s ─────────────────`);
    log('RPC'.padEnd(26) + 'n'.padStart(7) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'max'.padStart(8));
    for (const r of this.summaryRows()) {
      log(
        r.rpc.padEnd(26) +
          String(r.n).padStart(7) +
          String(r.p50).padStart(8) +
          String(r.p95).padStart(8) +
          String(r.p99).padStart(8) +
          String(r.max).padStart(8),
      );
    }
    log('');
    log('── Sayaçlar ──────────────────────────────────────────────');
    for (const [k, v] of [...this.counters.entries()].sort()) {
      log(`  ${k.padEnd(30)} ${v}`);
    }
    if (this.errors.size) {
      log('');
      log('── Hata/istisna kodları (bekleneni ayırt et) ─────────────');
      for (const [k, v] of [...this.errors.entries()].sort((a, b) => b[1] - a[1])) {
        log(`  ${String(k).slice(0, 40).padEnd(42)} ${v}`);
      }
    }
    log('');
  }

  toJSON() {
    return {
      startedAt: this.startedAt,
      durationMs: Date.now() - this.startedAt,
      rpc: this.summaryRows(),
      counters: Object.fromEntries(this.counters),
      errors: Object.fromEntries(this.errors),
    };
  }

  writeReport(dir) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
    // Date.now() dosya adı için yeterli (script; Workflow kısıtı yok).
    const path = `${dir}/loadtest-report-${this.startedAt}.json`;
    writeFileSync(path, JSON.stringify(this.toJSON(), null, 2));
    return path;
  }
}
