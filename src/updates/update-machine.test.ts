import {
  initialState,
  reducer,
  shouldShowOverlay,
  type UpdateEvent,
  type UpdateState,
} from './update-machine';

/** Bir olay dizisini baştan uygulayıp son durumu döndürür. */
function run(events: UpdateEvent[], from: UpdateState = initialState): UpdateState {
  return events.reduce(reducer, from);
}

describe('update-machine reducer', () => {
  it('idle olarak başlar', () => {
    expect(initialState).toEqual({ phase: 'idle' });
  });

  it('mutlu yol: kontrol → mevcut → indir → hazır', () => {
    const s = run([
      { type: 'CHECK_STARTED' },
      { type: 'UPDATE_AVAILABLE' },
      { type: 'DOWNLOAD_STARTED' },
      { type: 'DOWNLOAD_DONE' },
    ]);
    expect(s.phase).toBe('ready');
  });

  it('güncelleme yoksa none (fail-open → menü)', () => {
    const s = run([{ type: 'CHECK_STARTED' }, { type: 'NO_UPDATE' }]);
    expect(s.phase).toBe('none');
  });

  it('indirme koparsa error', () => {
    const s = run([
      { type: 'CHECK_STARTED' },
      { type: 'UPDATE_AVAILABLE' },
      { type: 'DOWNLOAD_STARTED' },
      { type: 'DOWNLOAD_FAILED' },
    ]);
    expect(s.phase).toBe('error');
  });

  it('error → tekrar dene (DOWNLOAD_STARTED) → indiriliyor', () => {
    const s = run([{ type: 'DOWNLOAD_STARTED' }], { phase: 'error' });
    expect(s.phase).toBe('downloading');
  });

  it('error → şimdilik geç (SKIP) → none', () => {
    const s = run([{ type: 'SKIP' }], { phase: 'error' });
    expect(s.phase).toBe('none');
  });

  it('bilinmeyen olayda durum değişmez', () => {
    const state: UpdateState = { phase: 'available' };
    // @ts-expect-error — kasıtlı geçersiz olay
    expect(reducer(state, { type: 'NOPE' })).toBe(state);
  });
});

describe('shouldShowOverlay', () => {
  it('kullanıcı etkileşimi gereken fazlarda overlay gösterilir', () => {
    for (const phase of ['available', 'downloading', 'ready', 'error'] as const) {
      expect(shouldShowOverlay(phase)).toBe(true);
    }
  });

  it('idle/checking/none fazlarında overlay gizli (menü açık)', () => {
    for (const phase of ['idle', 'checking', 'none'] as const) {
      expect(shouldShowOverlay(phase)).toBe(false);
    }
  });
});
