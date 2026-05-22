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
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const logRef    = useRef(null)
  const seenRef   = useRef(new Set())

  // DOM 직접 업데이트 — React 리렌더 없음
  const dbgLog = (msg) => { if (logRef.current) logRef.current.textContent = msg }

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
    let tick   = 0

    const handleCode = (text) => {
      dbgLog('인식: ' + text.slice(0, 60))
      if (!active || seenRef.current.has(text)) return
      seenRef.current.add(text)
      setItems(prev => [parseLabel(text), ...prev])
    }

    // 지정 너비로 캔버스에 그린 뒤 ImageData 반환 (캔버스 재할당 최소화)
    const capture = (targetW) => {
      const vW = video.videoWidth
      const vH = video.videoHeight
      const w  = Math.min(vW, targetW)
      const h  = Math.round(vH * w / vW)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w
        canvas.height = h
      }
      ctx.drawImage(video, 0, 0, w, h)
      return { data: ctx.getImageData(0, 0, w, h), w, h }
    }

    ;(async () => {
      try {
        // 카메라 최대 해상도 요청 — 멀리서도 QR이 충분한 픽셀 수를 갖도록
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        })
      } catch (e) {
        if (!active) return
        dbgLog('카메라오류: ' + e.message)
        setError('카메라 권한을 허용해주세요.')
        setScanning(false)
        return
      }
      if (!active) { stream.getTracks().forEach(t => t.stop()); return }

      video.srcObject = stream
      video.play().catch(() => {})
      dbgLog('카메라 시작됨 — zxing-wasm 로드중...')

      try { await readBarcodesFromImageData(new ImageData(1, 1), { formats: ['QRCode'] }) } catch {}

      dbgLog('준비완료 — 스캔중...')
      if (!active) return

      const scan = async () => {
        if (!active) return

        if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
          busy = true
          tick++

          try {
            const vW = video.videoWidth

            // ① 빠른 패스: 800px (원거리 QR 고려해 넉넉히), 최소 옵션
            //    → 매 프레임, busy 락으로 겹치지 않음 (병목 없음)
            const { data: fastData, w: fastW } = capture(800)
            let results = await readBarcodesFromImageData(fastData, {
              formats: ['QRCode', 'DataMatrix'],
              tryHarder:    false,
              tryRotate:    true,
              tryInvert:    false,
              tryDownscale: false,
              maxNumberOfSymbols: 1,
            })

            // ② 정밀 패스: 카메라 원본 해상도 (축소 없음) + 전체 옵션
            //    → 3프레임마다 한 번, 빠른 패스 실패 시만
            if (results.length === 0 && tick % 3 === 0) {
              const { data: fullData } = capture(vW)   // 원본 해상도 그대로
              results = await readBarcodesFromImageData(fullData, {
                formats: ['QRCode', 'DataMatrix'],
                tryHarder:    true,
                tryRotate:    true,
                tryInvert:    true,
                tryDownscale: true,
                maxNumberOfSymbols: 1,
              })
              dbgLog(`tick:${tick} | 정밀:${vW}px | ${results.length > 0 ? '인식!' : '없음'}`)
            } else if (results.length === 0) {
              dbgLog(`tick:${tick} | 빠른:${fastW}px | 없음`)
            }

            results.forEach(r => handleCode(r.text))
          } catch (e) {
            dbgLog('에러: ' + e.message)
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

        <div className="dbg" ref={logRef}>대기중</div>

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
