import { useState, useEffect, useRef } from 'react'
import jsQR from 'jsqr'
import './App.css'

function parseLabel(raw) {
  const s = raw.replace(/[\x00-\x1f]/g, '')
  const pPos = s.indexOf('P')
  const tPos = s.indexOf('1T')
  const lPos = s.indexOf('L', tPos)
  const pn = pPos >= 0 ? s.substring(pPos + 1, pPos + 11) : ''
  const sn = (pPos >= 0 && tPos > pPos) ? s.substring(pPos + 12, tPos) : ''
  const so = (tPos >= 0 && lPos > tPos) ? s.substring(tPos + 2, lPos) : ''
  return { pn, sn, so }
}

export default function App() {
  const [scanning, setScanning] = useState(false)
  const [tab, setTab]           = useState('scan')
  const [items, setItems]       = useState([])
  const [error, setError]       = useState(null)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const seenRef   = useRef(new Set())

  const startScan      = () => { setError(null); setScanning(true) }
  const stopScan       = () => setScanning(false)
  const switchToResult = () => { setScanning(false); setTab('result') }
  const clearAll       = () => { setItems([]); seenRef.current.clear() }

  useEffect(() => {
    if (!scanning) return

    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let stream      = null
    let intervalId  = null
    let active      = true
    let detector    = null

    // 네이티브 BarcodeDetector (iOS 17+ / Chrome)
    try {
      if ('BarcodeDetector' in window) {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      }
    } catch {}

    const handleCode = (text) => {
      if (!active || seenRef.current.has(text)) return
      seenRef.current.add(text)
      setItems(prev => [parseLabel(text), ...prev])
    }

    const scan = async () => {
      if (!active || video.readyState < 2 || !video.videoWidth) return

      // 640px 로 다운스케일 → jsQR 속도 향상
      const W = 640
      const H = Math.round(video.videoHeight * W / video.videoWidth)
      canvas.width  = W
      canvas.height = H
      ctx.drawImage(video, 0, 0, W, H)

      try {
        if (detector) {
          const codes = await detector.detect(canvas)
          if (codes.length) handleCode(codes[0].rawValue)
        } else {
          const img  = ctx.getImageData(0, 0, W, H)
          const code = jsQR(img.data, W, H, { inversionAttempts: 'attemptBoth' })
          if (code) handleCode(code.data)
        }
      } catch {}
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } })
      .then(s => {
        if (!active) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        video.srcObject = s
        video.play().catch(() => {})
        intervalId = setInterval(scan, 200)
      })
      .catch(() => {
        if (!active) return
        setError('카메라 권한을 허용해주세요.')
        setScanning(false)
      })

    return () => {
      active = false
      clearInterval(intervalId)
      stream?.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
  }, [scanning])

  const handleShare = async () => {
    const text = 'S/N\tP/N\tS/O\n' +
      [...items].reverse().map(it =>
        `${it.sn || '-'}\t${it.pn || '-'}\t${it.so || '-'}`
      ).join('\n')
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        alert('클립보드에 복사됐습니다')
      }
    } catch {}
  }

  return (
    <div className="app">

      {/* ── 탭 헤더 ── */}
      <div className="tab-bar">
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`}
          onClick={() => setTab('scan')}>스캔</button>
        <button className={`tab ${tab === 'result' ? 'active' : ''}`}
          onClick={switchToResult}>
          결과{items.length > 0 && <span className="badge">{items.length}</span>}
        </button>
      </div>

      {/* ── 스캔 패널 (항상 DOM에 존재, CSS만 숨김) ── */}
      <div className="scan-panel" style={{ display: tab === 'scan' ? 'flex' : 'none' }}>

        <div className="camera-wrap">
          <video ref={videoRef} playsInline muted
            style={{ display: scanning ? 'block' : 'none',
                     position: 'absolute', inset: 0,
                     width: '100%', height: '100%', objectFit: 'cover' }} />
          {!scanning &&
            <div style={{ position: 'absolute', inset: 0, background: '#ddd',
                          display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 64 }}>📷</div>}
        </div>

        {/* canvas: 화면에 안 보이고 스캔 연산용 */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {scanning
          ? <button className="btn-stop"  onClick={stopScan}>■ 스캔 종료</button>
          : <button className="btn-start" onClick={startScan}>📷 스캔 시작</button>}

        {error && <p className="error">{error}</p>}
        {items.length > 0 && <p className="scan-count">✓ {items.length}개 인식됨</p>}
      </div>

      {/* ── 결과 패널 (항상 DOM에 존재, CSS만 숨김) ── */}
      <div className="result-panel" style={{ display: tab === 'result' ? 'flex' : 'none' }}>
        {items.length === 0
          ? <p className="empty">스캔된 항목이 없습니다</p>
          : <>
              <div className="result-header">
                <span className="result-count">{items.length}개</span>
                <div className="result-btns">
                  <button className="btn-share" onClick={handleShare}>공유</button>
                  <button className="btn-clear" onClick={clearAll}>초기화</button>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>S/N</th><th>P/N</th><th>S/O</th></tr></thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td className="td-num">{items.length - i}</td>
                        <td>{item.sn || '—'}</td>
                        <td>{item.pn || '—'}</td>
                        <td>{item.so || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
        }
      </div>

    </div>
  )
}
