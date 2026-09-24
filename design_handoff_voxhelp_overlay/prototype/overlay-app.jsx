// VoxHelp overlay — root app: scene + glass panel, live simulation, tweaks.

const VH_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "tint": "graphite",
  "accentHue": 268,
  "blur": 34,
  "panelWidth": 400,
  "side": "right",
  "lang": "fr",
  "showCapsule": true,
  "autoStream": true
}/*EDITMODE-END*/;

/* Floating Electron "always-on-top" capsule (à la Cluely) */
function Capsule({ lang, status }) {
  const s = VOX.STATUS[status];
  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
      animation: 'vh-float 5s ease-in-out infinite',
    }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: 5,
      borderRadius: 99, background: 'var(--panel)',
      backdropFilter: 'blur(20px) saturate(160%)', WebkitBackdropFilter: 'blur(20px) saturate(160%)',
      boxShadow: 'var(--shadow-panel)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px 4px 7px' }}>
        <VHMark size={22} glow />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>VoxHelp</span>
      </div>
      <div style={{ width: 1, height: 18, background: 'var(--stroke)' }} />
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', fontSize: 12, color: 'var(--text-2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: s.kind === 'idle' ? 'var(--good)' : 'var(--accent)', animation: 'vh-pulse 1.6s infinite' }} />
        {s[lang]}
      </div>
      <button style={{ all: 'unset', cursor: 'pointer', width: 30, height: 30, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--card-hi)', color: 'var(--text-2)' }}>
        <VIcon name="stop" size={12} fill />
      </button>
    </div>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(VH_TWEAK_DEFAULTS);
  const lang = t.lang;

  // simulation state
  const pinned = useMemo(() => VOX.INSIGHTS.filter(i => i.pinned), []);
  const streamed = useMemo(() => VOX.INSIGHTS.filter(i => !i.pinned), []);
  const [feed, setFeed] = useState(pinned);          // chronological; newest last
  const [streamIdx, setStreamIdx] = useState(0);
  const [status, setStatus] = useState('listening');
  const [capIdx, setCapIdx] = useState(0);
  const [elapsed, setElapsed] = useState(474);       // 07:54
  const [newId, setNewId] = useState(null);
  const scrollRef = useRef(null);

  // apply theme tokens
  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute('data-tint', t.tint);
    r.style.setProperty('--blur', t.blur + 'px');
    r.style.setProperty('--accent', `oklch(0.68 0.15 ${t.accentHue})`);
    r.style.setProperty('--accent-soft', `oklch(0.68 0.15 ${t.accentHue} / 0.18)`);
    r.style.setProperty('--indigo', `oklch(0.70 0.14 ${t.accentHue})`);
    r.style.setProperty('--indigo-soft', `oklch(0.70 0.14 ${t.accentHue} / 0.16)`);
  }, [t.tint, t.blur, t.accentHue]);

  // elapsed clock
  useEffect(() => {
    const iv = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // status + caption cycle
  useEffect(() => {
    if (!t.autoStream) { setStatus('listening'); return; }
    let alive = true;
    const seq = ['speaking', 'speaking', 'analyzing', 'listening'];
    let i = 0;
    function tick() {
      if (!alive) return;
      const st = seq[i % seq.length];
      setStatus(st);
      if (st === 'speaking') setCapIdx(c => (c + 1) % VOX.CAPTIONS.length);
      i++;
    }
    tick();
    const iv = setInterval(tick, 2600);
    return () => { alive = false; clearInterval(iv); };
  }, [t.autoStream]);

  // stream new insights in after "analyzing"
  useEffect(() => {
    if (!t.autoStream || streamIdx >= streamed.length) return;
    if (status !== 'analyzing') return;
    const next = streamed[streamIdx];
    const to = setTimeout(() => {
      setFeed(f => f.find(x => x.id === next.id) ? f : [...f, next]);
      setNewId(next.id);
      setStreamIdx(i => i + 1);
    }, 1100);
    return () => clearTimeout(to);
  }, [status, streamIdx, t.autoStream]);

  // autoscroll to newest (bottom)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [feed.length]);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const panel = (
    <div style={{
      position: 'absolute', top: 18, bottom: 18,
      [t.side]: 18, width: t.panelWidth, maxWidth: 'calc(100vw - 36px)', zIndex: 20,
      display: 'flex', flexDirection: 'column',
      borderRadius: 'var(--radius)',
      background: 'var(--panel)',
      backdropFilter: `blur(var(--blur)) saturate(170%)`, WebkitBackdropFilter: `blur(var(--blur)) saturate(170%)`,
      boxShadow: 'var(--shadow-panel)',
      overflow: 'hidden',
    }}>
      {/* hairline top sheen */}
      <span style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: '0 0 0 1px var(--stroke) inset', pointerEvents: 'none', zIndex: 5 }} />
      {/* analyzing iridescent border sweep */}
      {status === 'analyzing' && !reduced && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', padding: 1.5, pointerEvents: 'none', zIndex: 6,
          background: 'linear-gradient(120deg, transparent 20%, var(--violet), var(--cyan), var(--accent), transparent 80%)',
          backgroundSize: '200% 100%', animation: 'vh-shimmer 1.6s linear infinite',
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude',
        }} />
      )}

      <PanelHeader status={status} lang={lang} onHide={() => {}} />
      <LiveCaption caption={VOX.CAPTIONS[capIdx]} lang={lang} speaking={status === 'speaking'} />

      {/* section label */}
      <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 9, flex: '0 0 auto' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{VOX.UI.analysis[lang]}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--stroke)' }} />
        <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{feed.length}</span>
      </div>

      {/* insight feed */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 14px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {feed.map((ins, idx) => (
          <InsightCard key={ins.id} insight={ins} lang={lang} isNew={ins.id === newId} dim={false} />
        ))}
      </div>

      <CommandBar lang={lang} elapsed={elapsed} onAction={() => {}} />
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="vh-wallpaper" />
      <MeetingScene side={t.side} />
      {t.showCapsule && <Capsule lang={lang} status={status} />}
      {panel}

      <TweaksPanel>
        <TweakSection label="Glass" />
        <TweakRadio label="Tint" value={t.tint} options={['graphite', 'indigo', 'frost']} onChange={v => setTweak('tint', v)} />
        <TweakSlider label="Blur" min={12} max={60} step={2} value={t.blur} onChange={v => setTweak('blur', v)} unit="px" />
        <TweakColor label="Accent" value={`oklch(0.68 0.15 ${t.accentHue})`}
          options={[`oklch(0.68 0.15 268)`, `oklch(0.7 0.15 300)`, `oklch(0.72 0.13 212)`, `oklch(0.74 0.15 158)`]}
          onChange={v => { const m = /\s(\d+(?:\.\d+)?)\)?$/.exec(v.trim()); if (m) setTweak('accentHue', parseFloat(m[1])); }} />
        <TweakSection label="Layout" />
        <TweakRadio label="Side" value={t.side} options={['left', 'right']} onChange={v => setTweak('side', v)} />
        <TweakSlider label="Panel width" min={340} max={460} step={10} value={t.panelWidth} onChange={v => setTweak('panelWidth', v)} unit="px" />
        <TweakToggle label="Floating capsule" value={t.showCapsule} onChange={v => setTweak('showCapsule', v)} />
        <TweakSection label="Content" />
        <TweakRadio label="Language" value={t.lang} options={['fr', 'en']} onChange={v => setTweak('lang', v)} />
        <TweakToggle label="Live analysis" value={t.autoStream} onChange={v => setTweak('autoStream', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
