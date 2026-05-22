import { useState, useEffect, useRef } from 'react'
import jsQR from 'jsqr'
import './App.css'

function parseLabel(raw) {
  const s = raw.replace(/[\x00-\x1f]/g, '')
  const pPos = s.indexOf('P')
  const tPos = s.indexOf('1T')
  const lPos = s.indexOf('L', tPos)
  const pn = pPos >= 0 ? s.substring(pPos + 1, pPos + 11) : ''
  const sn = pPos >= 0 && tPos > pPos ? s.substring(pPos + 12, tPos) : ''
  const so = tPos >= 0 && lPos > tPos ? s.substring(tPos + 2, lPos) : ''
  return { pn, sn, so }
}

// 네이티브 BarcodeDetector 지원 여부 확인
const nativeDetector = (() => {
  try {
    return 'BarcodeDetector' in window
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null
  } catch { return null }
})()

export default function App() {
  const [scanning, setScanning] = useState(false)
  const [tab, setTab]           = useState('scan')
  const [items, setItems]       = useState([])
  const [error, setError]       = useState(null)
  const seenRef = useRef(new Set())

  const startScan     = () => { setError(null); setScanning(true) }
  const stopScan      = () => setScanning(false)
  const switchToResult = () => { setScanning(false); setTab('result') }

  useEffect(() => {
    if (!scanning) return

    const container = document.getElementById('reader')

    // video 직접 생성 → 크기 완전 제어
    const video = document.createElement('video')
    video.setAttribute('playsinline', '')
    video.setAttribute('muted', '')
    video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:block;'
    container.appendChild(video)

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let animId = null
    let stream = null
    let active = true

    const handleCode = (text) => {
      if (!seenRef.current.has(text)) {
        seenRef.current.add(text)
        setItems(prev => [parseLabel(text), ...prev])
      }
    }

    const tick = async () => {
      if (!active) return
      if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width  = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        try {
          if (nativeDetector) {
            // iOS 17+ 네이티브 QR 인식
            const codes = await nativeDetector.detect(canvas)
            codes.forEach(c => handleCode(c.rawValue))
          } else {
            // 폴백: jsQR
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height)
            if (code) handleCode(code.data)
          }
        } catch { /* 인식 실패는 무시 */ }
      }
      animId = requestAnimationFrame(tick)
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then(s => {
        if (!active) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        video.srcObject = s
        video.play().catch(() => {})
        animId = requestAnimationFrame(tick)
      })
      .catch(() => {
        setError('카메라 권한을 허용해주세요.')
        setScanning(false)
      })

    return () => {
      active = false
      cancelAnimationFrame(animId)
      stream?.getTracks().forEach(t => t.stop())
      if (container) container.innerHTML = ''
    }
  }, [scanning])

  const clearAll = () => { setItems([]); seenRef.current.clear() }

  const handleShare = async () => {
    const header = 'S/N\tP/N\tS/O'
    const rows = [...items].reverse()
      .map(it => `${it.sn || '-'}\t${it.pn || '-'}\t${it.so || '-'}`)
      .join('\n')
    const text = header + '\n' + rows
    if (navigator.share) {
      await navigator.share({ text })
    } else {
      await navigator.clipboard.writeText(text)
      alert('클립보드에 복사됐습니다')
    }
  }

  return (
    <div className="app">
      {/* 탭 헤더 */}
      <div className="tab-bar">
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
          스캔
        </button>
        <button className={`tab ${tab === 'result' ? 'active' : ''}`} onClick={switchToResult}>
          결과 {items.length > 0 && <span className="badge">{items.length}</span>}
        </button>
      </div>

      {/* 스캔 패널 — 항상 DOM에 존재 */}
      <div className="scan-panel" style={{ display: tab === 'scan' ? 'flex' : 'none' }}>
        <div className="camera-wrap">
          {/* #reader: video 가 여기 주입됨, position:relative 필수 */}
          <div id="reader" />
          {!scanning && <div className="camera-placeholder" />}
        </div>
        {scanning
          ? <button className="btn-cancel" onClick={stopScan}>스캔 종료</button>
          : <button className="btn-primary" onClick={startScan}>📷 스캔 시작</button>
        }
        {error && <p className="error">{error}</p>}
        {items.length > 0 && <p className="scan-count">인식 {items.length}개</p>}
      </div>

      {/* 결과 패널 — 항상 DOM에 존재 */}
      <div className="result-panel" style={{ display: tab === 'result' ? 'flex' : 'none' }}>
        <div className="result-actions">
          {items.length > 0 && (
            <>
              <button className="btn-share" onClick={handleShare}>공유</button>
              <button className="btn-clear" onClick={clearAll}>초기화</button>
            </>
          )}
        </div>
        {items.length === 0
          ? <p className="empty">스캔된 항목이 없습니다</p>
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>S/N</th><th>P/N</th><th>S/O</th></tr></thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td className="num">{items.length - i}</td>
                      <td>{item.sn || '—'}</td>
                      <td>{item.pn || '—'}</td>
                      <td>{item.so || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}
