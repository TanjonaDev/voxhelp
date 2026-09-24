// VoxHelp overlay — the video meeting behind the glass (Google Meet recreation).
function MeetTile({ name, initial, grad, big, muted, speaking }) {
  return (
    <div style={{
      position: 'relative', borderRadius: big ? 16 : 12, overflow: 'hidden',
      background: grad, flex: big ? '1 1 auto' : '0 0 auto',
      width: big ? 'auto' : 188, height: big ? 'auto' : 132,
      boxShadow: speaking ? '0 0 0 3px oklch(0.78 0.13 70)' : 'none',
    }}>
      {/* avatar circle */}
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{
          width: big ? 132 : 64, height: big ? 132 : 64, borderRadius: '50%',
          background: 'hsl(0 0% 100% / 0.16)', display: 'grid', placeItems: 'center',
          color: 'white', fontWeight: 600, fontSize: big ? 54 : 26, fontFamily: 'var(--font)',
        }}>{initial}</div>
      </div>
      {/* name chip */}
      <div style={{
        position: 'absolute', left: big ? 18 : 10, bottom: big ? 16 : 9,
        color: 'white', fontSize: big ? 17 : 12.5, fontWeight: 500,
        textShadow: '0 1px 3px hsl(0 0% 0% / 0.5)',
      }}>{name}</div>
      {/* mute icon */}
      {muted && (
        <div style={{
          position: 'absolute', right: big ? 16 : 9, top: big ? 16 : 9,
          width: big ? 34 : 26, height: big ? 34 : 26, borderRadius: '50%',
          background: 'hsl(0 0% 8% / 0.55)', display: 'grid', placeItems: 'center', color: 'white',
        }}>
          <svg width={big ? 17 : 13} height={big ? 17 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2 22 22M9 5a3 3 0 0 1 6 0v5M15 12.5A3 3 0 0 1 9 11v-1M5 10a7 7 0 0 0 10.5 6M12 17v4" />
          </svg>
        </div>
      )}
    </div>
  );
}

function MeetControl({ icon, danger }) {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center',
      background: danger ? 'oklch(0.58 0.2 25)' : 'hsl(0 0% 100% / 0.10)',
      color: 'white', flex: '0 0 auto',
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
    </div>
  );
}

function MeetingScene({ side }) {
  // pushes the meeting window slightly away from the panel side
  return (
    <div className="vh-meet" style={{
      position: 'absolute', inset: 0, zIndex: 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '34px 30px',
    }}>
      {/* macOS-style meeting window */}
      <div style={{
        width: 'min(1180px, 92%)', height: 'min(820px, 94%)', borderRadius: 18, overflow: 'hidden',
        background: '#0d0f12', boxShadow: '0 40px 120px -30px hsl(230 50% 4% / 0.8), 0 0 0 1px hsl(0 0% 100% / 0.06)',
        display: 'flex', flexDirection: 'column',
        marginRight: side === 'right' ? 'min(360px, 30%)' : 0,
        marginLeft: side === 'left' ? 'min(360px, 30%)' : 0,
        transition: 'margin 0.4s cubic-bezier(.2,.8,.2,1)',
      }}>
        {/* titlebar */}
        <div style={{ height: 40, flex: '0 0 auto', background: '#16191e', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderBottom: '1px solid hsl(0 0% 100% / 0.05)' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map(c => <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />)}
          <div style={{ flex: 1, textAlign: 'center', color: 'hsl(0 0% 100% / 0.45)', fontSize: 12.5, fontWeight: 500, marginRight: 52 }}>
            meet.google.com — Entretien · Backend
          </div>
        </div>
        {/* stage */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', padding: 18, gap: 14, minHeight: 0 }}>
          <MeetTile big name="Tanjona Rakotoarisoa" initial="T" muted
            grad="radial-gradient(120% 120% at 50% 38%, oklch(0.55 0.2 28), oklch(0.32 0.16 25) 70%, oklch(0.2 0.08 25))" />
          {/* self PiP */}
          <div style={{ position: 'absolute', right: 28, bottom: 92, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <MeetTile name="Vous" initial="R" muted
              grad="radial-gradient(120% 120% at 50% 40%, oklch(0.6 0.13 195), oklch(0.34 0.1 200) 72%, oklch(0.22 0.06 205))" />
          </div>
        </div>
        {/* control bar */}
        <div style={{ height: 78, flex: '0 0 auto', background: '#16191e', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, borderTop: '1px solid hsl(0 0% 100% / 0.05)' }}>
          <MeetControl icon={<><path d="M2 2 22 22M9 5a3 3 0 0 1 6 0v5M15 12.5A3 3 0 0 1 9 11v-1M5 10a7 7 0 0 0 10.5 6M12 17v4" /></>} danger />
          <MeetControl icon={<><path d="M2 2 22 22M16 9.34V6a2 2 0 0 0-2-2H6.34M2 8a2 2 0 0 0-.34 1v6a2 2 0 0 0 2 2h9M22 8l-5 4 5 4z" /></>} danger />
          <MeetControl icon={<><path d="M4 4h16v12H4zM8 20h8M12 16v4" /></>} />
          <MeetControl icon={<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></>} />
          <MeetControl icon={<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></>} />
          <div style={{ width: 1, height: 30, background: 'hsl(0 0% 100% / 0.1)', margin: '0 4px' }} />
          <MeetControl danger icon={<><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></>} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MeetingScene });
