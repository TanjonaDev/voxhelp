// VoxHelp overlay — the glass panel (header, live caption, insight cards, command bar).

/* ============ Header: brand + live status ============ */
function PanelHeader({ status, lang, onHide }) {
  const s = VOX.STATUS[status];
  const UI = VOX.UI;
  const isThink = s.kind === 'think';
  const isLive = s.kind === 'live';
  return (
    <div style={{ padding: '13px 15px 11px', flex: '0 0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <VHMark size={30} glow={isThink || isLive} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{UI.brand}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 500 }}>{UI.role[lang]}</span>
        </div>
        {/* live status pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 11px 5px 9px',
          borderRadius: 99, background: 'var(--card)', boxShadow: '0 0 0 1px var(--stroke) inset',
        }}>
          {isLive ? (
            <span style={{ color: 'var(--good)' }}><LiveWave active bars={9} h={13} w={2} color="currentColor" /></span>
          ) : isThink ? (
            <span style={{ width: 13, height: 13, display: 'grid', placeItems: 'center' }}>
              <span style={{
                width: 12, height: 12, borderRadius: '50%',
                background: 'conic-gradient(from 0deg, transparent, var(--accent))',
                WebkitMask: 'radial-gradient(circle 3.5px at center, transparent 96%, #000)',
                mask: 'radial-gradient(circle 3.5px at center, transparent 96%, #000)',
                animation: 'vh-spin 0.9s linear infinite',
              }} />
            </span>
          ) : (
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--good)', animation: 'vh-pulse 1.8s infinite' }} />
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: isThink ? 'var(--accent)' : 'var(--text-2)' }}>{s[lang]}</span>
        </div>
        <GhostBtn icon="eye" label={VOX.UI.hide[lang]} onClick={onHide} />
      </div>
    </div>
  );
}

/* ============ Live caption strip ============ */
function LiveCaption({ caption, lang, speaking }) {
  return (
    <div style={{ padding: '0 15px 10px', flex: '0 0 auto' }}>
      <div style={{
        borderRadius: 14, padding: '9px 12px', background: 'var(--card)',
        boxShadow: '0 0 0 1px var(--stroke) inset', display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <span style={{
          flex: '0 0 auto', width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center',
          background: 'var(--card-hi)', color: speaking ? 'var(--good)' : 'var(--text-3)',
        }}>
          <VIcon name="mic" size={14} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              {VOX.UI.liveCaption[lang]}
            </span>
            {speaking && <span style={{ color: 'var(--good)' }}><LiveWave active bars={5} h={9} w={1.5} color="currentColor" /></span>}
          </div>
          <p key={caption[lang]} style={{
            margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-2)', fontStyle: 'italic',
            animation: 'vh-caption-in 0.4s both',
          }}>“{caption[lang]}”</p>
        </div>
      </div>
    </div>
  );
}

/* ============ Insight card — a floating AI thought ============ */
function InsightCard({ insight, lang, isNew, dim }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const meta = VOX.CATEGORIES[insight.cat];
  const colorVar = `var(--${meta.color})`;
  const UI = VOX.UI;

  function copy() {
    const txt = insight.title[lang] + '\n' + insight.body[lang] + (insight.relance ? '\n→ ' + insight.relance[lang] : '');
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={isNew ? 'vh-anim' : undefined}
      style={{
        position: 'relative', borderRadius: 'var(--radius-card)', padding: '13px 14px', flex: '0 0 auto',
        background: hover ? 'var(--card-hi)' : 'var(--card)',
        boxShadow: hover
          ? `0 0 0 1px var(--stroke-2) inset, 0 10px 30px -12px hsl(230 40% 4% / 0.6)`
          : `0 0 0 1px var(--stroke) inset, var(--shadow-card)`,
        opacity: dim ? 0.66 : 1,
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'background .18s, box-shadow .18s, transform .18s, opacity .3s',
        animation: isNew ? 'vh-thought-in 0.55s cubic-bezier(.2,.8,.2,1) both' : 'none',
        overflow: 'hidden',
      }}>
      {/* accent rail */}
      <span style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: 99, background: colorVar, opacity: 0.85 }} />
      {/* new-thought glow */}
      {isNew && <span style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: `0 0 0 1px ${colorVar} inset`, opacity: 0.5, animation: 'vh-glow-fade 2.4s ease forwards', pointerEvents: 'none' }} />}

      {/* top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <CategoryTag cat={insight.cat} lang={lang} />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-3)' }}>{insight.t}</span>
        <Confidence level={insight.confidence} lang={lang} showLabel={false} />
      </div>

      {/* title */}
      <h3 style={{ margin: '0 0 7px', fontSize: 14.5, fontWeight: 600, lineHeight: 1.32, letterSpacing: '-0.005em', color: 'var(--text)', textWrap: 'pretty' }}>
        {insight.title[lang]}
      </h3>

      {/* level meter (only for level cards) */}
      {typeof insight.level === 'number' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 9px' }}>
          <div style={{ flex: 1, height: 5, borderRadius: 99, background: 'hsl(0 0% 100% / 0.10)', overflow: 'hidden' }}>
            <div style={{ width: `${insight.level * 100}%`, height: '100%', borderRadius: 99, background: `linear-gradient(90deg, var(--cyan), var(--indigo))` }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)' }}>{insight.levelLabel[lang]}</span>
        </div>
      )}

      {/* body — "what this means" */}
      <div style={{ marginBottom: insight.relance ? 11 : 2 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>
          {UI.meansLabel[lang]}
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)', textWrap: 'pretty' }}>{insight.body[lang]}</p>
      </div>

      {/* suggested follow-up */}
      {insight.relance && (
        <div style={{ borderRadius: 12, padding: '9px 11px', background: 'var(--accent-soft)', boxShadow: '0 0 0 1px var(--indigo-soft) inset' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <VIcon name="chat" size={12} style={{ color: 'var(--indigo)' }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--indigo)' }}>{UI.askLabel[lang]}</span>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', fontWeight: 500, textWrap: 'pretty' }}>{insight.relance[lang]}</p>
        </div>
      )}

      {/* hover actions */}
      <div style={{
        position: 'absolute', top: 11, right: 12, display: 'flex', gap: 4,
        opacity: hover ? 1 : 0, transform: hover ? 'none' : 'translateY(-3px)',
        transition: 'opacity .15s, transform .15s', pointerEvents: hover ? 'auto' : 'none',
      }}>
        <GhostBtn icon={copied ? 'check' : 'copy'} label={UI.actions.copy[lang]} onClick={copy} size={26} iconSize={13} style={{ background: 'var(--panel)' }} />
        <GhostBtn icon="pin" label={UI.actions.pin[lang]} onClick={() => setPinned(p => !p)} active={pinned} size={26} iconSize={13} style={{ background: 'var(--panel)' }} />
      </div>
    </div>
  );
}

/* ============ Command bar (Cluely-style) + footer ============ */
function CommandBar({ lang, elapsed, onAction }) {
  const UI = VOX.UI;
  const [val, setVal] = useState('');
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0');
  const pills = [
    { id: 'assist', icon: 'sparkle', label: UI.actions.assist[lang] },
    { id: 'followups', icon: 'chat', label: UI.actions.followups[lang] },
    { id: 'recap', icon: 'refresh', label: UI.actions.recap[lang] },
  ];
  return (
    <div style={{ flex: '0 0 auto', padding: '10px 14px 12px', borderTop: '1px solid var(--stroke)' }}>
      {/* action pills */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 9 }}>
        {pills.map(p => (
          <button key={p.id} onClick={() => onAction(p.id)} style={{
            all: 'unset', cursor: 'pointer', flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 6px', borderRadius: 11, background: 'var(--card)', boxShadow: '0 0 0 1px var(--stroke) inset',
            fontSize: 12, fontWeight: 600, color: 'var(--text-2)', transition: 'all .15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-hi)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--card)'; e.currentTarget.style.color = 'var(--text-2)'; }}>
            <VIcon name={p.icon} size={14} /> {p.label}
          </button>
        ))}
      </div>
      {/* ask input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 13px', borderRadius: 13, background: 'var(--card)', boxShadow: '0 0 0 1px var(--stroke) inset', marginBottom: 10 }}>
        <VIcon name="sparkle" size={15} style={{ color: 'var(--accent)' }} fill />
        <input value={val} onChange={e => setVal(e.target.value)} placeholder={UI.ask[lang]}
          style={{ all: 'unset', flex: 1, fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)', minWidth: 0 }} />
        <button onClick={() => setVal('')} style={{ all: 'unset', cursor: 'pointer', width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: val.trim() ? 'var(--accent)' : 'var(--card-hi)', color: 'white', transition: 'background .15s' }}>
          <VIcon name="send" size={14} />
        </button>
      </div>
      {/* recording footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--risk)', animation: 'vh-pulse 1.6s infinite', boxShadow: '0 0 8px -1px var(--risk)' }} />
          {UI.recording[lang]}
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>· {mm}:{ss}</span>
        </span>
        <span style={{ flex: 1 }} />
        <button style={{
          all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 9, background: 'var(--risk-soft)', color: 'var(--risk)',
          fontSize: 12.5, fontWeight: 600, boxShadow: '0 0 0 1px var(--risk-soft) inset',
        }}>
          <VIcon name="stop" size={11} fill /> {UI.stop[lang]}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { PanelHeader, LiveCaption, InsightCard, CommandBar });
