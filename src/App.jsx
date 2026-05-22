import { useState, useEffect, useRef } from 'react'
import { readBarcodesFromImageData, setZXingModuleOverrides } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import './App.css'

setZXingModuleOverrides({ locateFile: (p) => p.endsWith('.wasm') ? wasmUrl : p })

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
  const [log, setLog]           = useState('대기중')
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

    const ctx  = canvas.getContext('2d', { willReadFrequently: true })
    let stream = null
    let animId = null
    let active = true
    let busy   = false

    const handleCode = (text) => {
      setLog('인식: ' + text.slice(0, 50))
      if (!active || seenRef.current.has(text)) return
      seenRef.current.add(text)
      setItems(prev => [parseLabel(text), ...prev])
    }

    ;(async () => {
      // ① 카메라 시작
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 } }
        })
      } catch (e) {
        if (!active) return
        setLog('카메라오류: ' + e.message)
        setError('카메라 권한을 허용해주세요.')
        setScanning(false)
        return
      }
      if (!active) { stream.getTracks().forEach(t => t.stop()); return }

      video.srcObject = stream
      video.play().catch(() => {})
      setLog('카메라 시작됨 — zxing-wasm 로드중...')

      // ② zxing-wasm 워밍업 (첫 호출 시 WASM 로드)
      try {
        const dummy = new ImageData(1, 1)
        await readBarcodesFromImageData(dummy, { formats: ['QRCode'] })
      } catch {}

      setLog('준비완료 — 스캔중...')
      if (!active) return

      let tick = 0

      // ③ 60fps 스캔
      const scan = async () => {
        if (!active) return

        if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
          busy = true
          tick++
          try {
            // 800px 로 스케일 (각도·왜곡 커버 위해 jsQR보다 높게)
            const W = Math.min(video.videoWidth, 800)
            const H = Math.round(video.videoHeight * W / video.videoWidth)
            canvas.width  = W
            canvas.height = H
            ctx.drawImage(video, 0, 0, W, H)
            const imageData = ctx.getImageData(0, 0, W, H)

            const results = await readBarcodesFromImageData(imageData, {
              formats:            ['QRCode', 'DataMatrix'],
              tryHarder:          true,   // 더 많은 패턴 시도
              tryRotate:          true,   // 각도 보정
              tryInvert:          true,   // 반전 시도
              tryDownscale:       true,   // 내부 다운스케일
              maxNumberOfSymbols: 1,
            })

            if (results.length === 0) {
              setLog(`tick:${tick} | 코드없음`)
            } else {
              results.forEach(r => handleCode(r.text))
            }
          } catch (e) {
            setLog('스캔에러: ' + e.message)
          }
          busy = false
        }

        animId = requestAnimationFrame(scan)
      }

      animId = requestAnimationFrame(scan)
    })()

    return () => {
      active = false
      cancelAnimationFrame(animId)
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

      <div className="scan-panel" style={{ display: tab === 'scan' ? 'flex' : 'none' }}>
        <div className="camera-wrap">
          <video ref={videoRef} playsInline muted
            style={{ display: scanning ? 'block' : 'none',
                     position: 'absolute', inset: 0,
                     width: '100%', height: '100%', objectFit: 'cover' }} />
          {!scanning && <div className="cam-idle">📷</div>}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {scanning
          ? <button className="btn-stop"  onClick={stopScan}>■ 스캔 종료</button>
          : <button className="btn-start" onClick={startScan}>📷 스캔 시작</button>}

        {/* 로그 */}
        <div className="dbg">{log}</div>

        {error && <p className="error">{error}</p>}
        {items.length > 0 && <p className="scan-count">✓ {items.length}개 인식됨</p>}
      </div>

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
