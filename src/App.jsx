import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
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

export default function App() {
  const [started, setStarted] = useState(false)
  const [tab, setTab]         = useState('scan')   // 'scan' | 'result'
  const [items, setItems]     = useState([])
  const [error, setError]     = useState(null)
  const scannerRef = useRef(null)
  const seenRef    = useRef(new Set())

  const launch = async () => {
    setError(null)
    const scanner = new Html5Qrcode('reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    })
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
        { fps: 10 },
        (text) => {
          if (seenRef.current.has(text)) return
          seenRef.current.add(text)
          setItems(prev => [parseLabel(text), ...prev])
        },
        () => {}
      )
      setStarted(true)
    } catch (e) {
      setStarted(false)
      setError('카메라 권한 오류. Safari 설정 → 카메라 → 허용 후 재시도하세요.')
    }
  }

  const stop = () => {
    scannerRef.current?.stop().catch(() => {})
    setStarted(false)
  }

  const switchTab = (next) => {
    setTab(next)
    // 결과 탭 → 카메라 일시 정지
    if (next === 'result' && started) stop()
  }

  const clearAll = () => { setItems([]); seenRef.current.clear() }

  const handleShare = async () => {
    const header = 'S/N\tP/N\tS/O'
    const rows = [...items].reverse().map(it =>
      `${it.sn || '-'}\t${it.pn || '-'}\t${it.so || '-'}`
    ).join('\n')
    const text = header + '\n' + rows
    if (navigator.share) {
      await navigator.share({ text })
    } else {
      await navigator.clipboard.writeText(text)
      alert('클립보드에 복사됐습니다')
    }
  }

  useEffect(() => () => { scannerRef.current?.stop().catch(() => {}) }, [])

  return (
    <div className="app">
      {/* 탭 헤더 */}
      <div className="tab-bar">
        <button
          className={`tab ${tab === 'scan' ? 'active' : ''}`}
          onClick={() => setTab('scan')}
        >스캔</button>
        <button
          className={`tab ${tab === 'result' ? 'active' : ''}`}
          onClick={() => switchTab('result')}
        >
          결과 {items.length > 0 && <span className="badge">{items.length}</span>}
        </button>
      </div>

      {/* 스캔 탭 */}
      {tab === 'scan' && (
        <div className="scan-panel">
          <div className="camera-wrap">
            <div id="reader" className={started ? '' : 'reader-hidden'} />
          </div>
          {started ? (
            <button className="btn-cancel" onClick={stop}>스캔 종료</button>
          ) : (
            <button className="btn-primary" onClick={launch}>스캔 시작</button>
          )}
          {error && <p className="error">{error}</p>}
          {items.length > 0 && (
            <p className="scan-count">인식 {items.length}개 — 결과 탭에서 확인</p>
          )}
        </div>
      )}

      {/* 결과 탭 */}
      {tab === 'result' && (
        <div className="result-panel">
          <div className="result-actions">
            {items.length > 0 && (
              <>
                <button className="btn-share" onClick={handleShare}>공유</button>
                <button className="btn-clear" onClick={clearAll}>초기화</button>
              </>
            )}
          </div>
          {items.length === 0 ? (
            <p className="empty">스캔된 항목이 없습니다</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>S/N</th><th>P/N</th><th>S/O</th></tr>
                </thead>
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
          )}
        </div>
      )}
    </div>
  )
}
