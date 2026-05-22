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
    let stream     = null
    let intervalId = null
    let active     = true

    const handleCode = (text) => {
      if (!active || seenRef.current.has(text)) return
      seenRef.current.add(text)
      setItems(prev => [parseLabel(text), ...prev])
    }

    ;(async () => {
      // ① 카메라 먼저 시작 — getUserMedia 는 가능한 한 빨리 호출
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 } }
        })
      } catch {
        if (!active) return
        setError('카메라 권한을 허용해주세요.')
        setScanning(false)
        return
      }
      if (!active) { stream.getTracks().forEach(t => t.stop()); return }

      video.srcObject = stream
      video.play().catch(() => {})

      // ② BarcodeDetector 초기화 (카메라 시작 후에 해도 됨)
      let detector = null
      if ('BarcodeDetector' in window) {
        try {
          // 지원 포맷 확인 후 사용 가능한 것만 추가
          const supported  = await window.BarcodeDetector.getSupportedFormats().catch(() => [])
          const wantFormats = ['qr_code', 'data_matrix']
          const useFormats  = supported.length
            ? wantFormats.filter(f => supported.includes(f))
            : wantFormats
          detector = new window.BarcodeDetector({ formats: useFormats.length ? useFormats : ['qr_code'] })
        } catch {}
      }

      if (!active) return

      // ③ 스캔 루프
      const scan = async () => {
        if (!active || video.readyState < 2 || !video.videoWidth) return

        try {
          if (detector) {
            // BarcodeDetector: video 요소 직접 전달 (canvas 우회 → iOS 호환)
            const codes = await detector.detect(video)
            codes.forEach(c => handleCode(c.rawValue))
          } else {
            // jsQR 폴백: canvas 경유
            const W = Math.min(video.videoWidth, 960)
            const H = Math.round(video.videoHeight * W / video.videoWidth)
            canvas.width  = W
            canvas.height = H
            ctx.drawImage(video, 0, 0, W, H)
            const img  = ctx.getImageData(0, 0, W, H)
            const code = jsQR(img.data, W, H, { inversionAttempts: 'attemptBoth' })
            if (code) handleCode(code.data)
          }
        } catch {}
      }

      intervalId = setInterval(scan, 150)
    })()

    return () => {
      active = false
      clearInterval(intervalId)
      stream?.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
  }, [scanning])

  const handleShare = async () => {
    const text = 'S/N\tP/N\tS/O\n' +
      [...items].reverse()
        .map(it => `${it.sn || '-'}\t${it.pn || '-'}\t${it.so || '-'}`)
        .join('\n')
    try {
      if (navigator.share) await navigator.share({ text })
      else { await navigator.clipboard.writeText(text); alert('클립보드에 복사됐습니다') }
    } catch {}
  }

  return (
    <div className="app">

      <div className="tab-bar">
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`}
          onClick={() => setTab('scan')}>스캔</button>
        <button className={`tab ${tab === 'result' ? 'active' : ''}`}
          onClick={switchToResult}>
          결과{items.length > 0 && <span className="badge">{items.length}</span>}
        </button>
      </div>

      {/* 스캔 패널 — 항상 DOM 유지 */}
      <div className="scan-panel" style={{ display: tab === 'scan' ? 'flex' : 'none' }}>
        <div className="camera-wrap">
          <video ref={videoRef} playsInline muted
            style={{ display: scanning ? 'block' : 'none',
                     position: 'absolute', inset: 0,
                     width: '100%', height: '100%', objectFit: 'cover' }} />
          {!scanning &&
            <div className="cam-idle">📷</div>}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {scanning
          ? <button className="btn-stop"  onClick={stopScan}>■ 스캔 종료</button>
          : <button className="btn-start" onClick={startScan}>📷 스캔 시작</button>}

        {error && <p className="error">{error}</p>}
        {items.length > 0 && <p className="scan-count">✓ {items.length}개 인식됨</p>}
      </div>

      {/* 결과 패널 — 항상 DOM 유지 */}
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
