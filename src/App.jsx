import { useState, useEffect, useRef } from 'react'
import { readBarcodesFromImageData, setZXingModuleOverrides } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import './App.css'

setZXingModuleOverrides({ locateFile: (p) => p.endsWith('.wasm') ? wasmUrl : p })

function parseLabel(raw) {
  const s = raw.replace(/[\x00-\x1f␀-␟]/g, '')
  const pIdx  = s.indexOf('P')
  const sIdx  = s.indexOf('S',  pIdx + 1)
  const tIdx  = s.indexOf('1T', sIdx + 1)
  const lIdx  = s.indexOf('4LK', tIdx + 1)
  const pn = pIdx >= 0 && sIdx  > pIdx  ? s.slice(pIdx  + 1, sIdx)      : ''
  const sn = sIdx >= 0 && tIdx  > sIdx  ? s.slice(sIdx  + 1, tIdx)      : ''
  const so = tIdx >= 0 && lIdx  > tIdx  ? s.slice(tIdx  + 2, lIdx)      : ''
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
  const flashRef  = useRef(null)
  const seenRef   = useRef(new Set())

  const triggerFeedback = () => {
    // 진동 (Android)
    navigator.vibrate?.(80)
    // 삑 소리 (Web Audio API — iOS 포함)
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)()
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 1046  // 고음 C6
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.12)
    } catch {}
    // 화면 점멸
    const el = flashRef.current
    if (el) {
      el.classList.remove('flash-active')
      void el.offsetWidth  // reflow — 애니메이션 재시작
      el.classList.add('flash-active')
    }
  }

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
      triggerFeedback()
      const clean = text.replace(/[\x00-\x1f␀-␟]/g, '')
      setItems(prev => [{ ...parseLabel(text), raw: clean }, ...prev])
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

  const share = async (text) => {
    try {
      if (navigator.share) await navigator.share({ text })
      else { await navigator.clipboard.writeText(text); alert('클립보드에 복사됐습니다') }
    } catch {}
  }
  const handleShare    = () => {
    const rows = [...items].reverse()
    share('No.\tS/N\tP/N\tS/O\n' +
      rows.map((it, i) => `${i + 1}\t${it.sn || '-'}\t${it.pn || '-'}\t${it.so || '-'}`).join('\n'))
  }
  const handleShareRaw = () => {
    share([...items].reverse().map(it => it.raw).join('\n'))
  }

  return (
    <div className="app">
      <div ref={flashRef} className="scan-flash" />
      <div className="watermark">한솔아이원스 박혜근 선임</div>

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
          {scanning && <>
            <div className="scan-corner scan-corner--tl" />
            <div className="scan-corner scan-corner--tr" />
            <div className="scan-corner scan-corner--bl" />
            <div className="scan-corner scan-corner--br" />
          </>}
          {!scanning && (
            <div className="cam-idle">
              <div className="cam-idle-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <span className="cam-idle-text">카메라 시작</span>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {scanning
          ? <button className="btn-stop"  onClick={stopScan}>■ 스캔 종료</button>
          : <button className="btn-start" onClick={startScan}>📷 스캔 시작</button>}

        {error && <p className="error">{error}</p>}
        <div className={`scan-counter ${scanning && items.length > 0 ? 'counter--active' : !scanning && items.length > 0 ? 'counter--done' : 'counter--idle'}`}>
          {items.length}
        </div>
      </div>

      <div className="result-panel" style={{ display: tab === 'result' ? 'flex' : 'none' }}>
        {items.length === 0
          ? <p className="empty">스캔된 항목이 없습니다</p>
          : <>
              <div className="result-header">
                <span className="result-count">{items.length}개</span>
                <div className="result-btns">
                  <button className="btn-share" onClick={handleShare}>공유</button>
                  <button className="btn-share-raw" onClick={handleShareRaw}>원문</button>
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
