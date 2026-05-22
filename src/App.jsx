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
  const [scanning, setScanning] = useState(false)
  const [tab, setTab]           = useState('scan')
  const [items, setItems]       = useState([])
  const [error, setError]       = useState(null)
  const scannerRef = useRef(null)
  const seenRef    = useRef(new Set())

  // 버튼은 상태만 바꿈 → useEffect가 DOM 업데이트 후 카메라 초기화
  const startScan = () => { setError(null); setScanning(true) }
  const stopScan  = () => setScanning(false)

  const switchTab = (next) => {
    if (next === 'result') setScanning(false)
    setTab(next)
  }

  useEffect(() => {
    if (!scanning) {
      scannerRef.current?.stop().catch(() => {})
      return
    }

    const scanner = new Html5Qrcode('reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ],
      verbose: false,
    })
    scannerRef.current = scanner

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10 },
      (text) => {
        if (seenRef.current.has(text)) return
        seenRef.current.add(text)
        setItems(prev => [parseLabel(text), ...prev])
      },
      () => {}
    ).catch(() => {
      setError('카메라 권한을 허용해주세요.')
      setScanning(false)
    })

    return () => { scanner.stop().catch(() => {}) }
  }, [scanning])

  useEffect(() => () => { scannerRef.current?.stop().catch(() => {}) }, [])

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

  return (
    <div className="app">
      <div className="tab-bar">
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
          스캔
        </button>
        <button className={`tab ${tab === 'result' ? 'active' : ''}`} onClick={() => switchTab('result')}>
          결과 {items.length > 0 && <span className="badge">{items.length}</span>}
        </button>
      </div>

      {tab === 'scan' && (
        <div className="scan-panel">
          {/* #reader 는 항상 DOM에 존재해야 함 */}
          <div className="camera-wrap">
            <div id="reader" className={scanning ? '' : 'reader-idle'} />
          </div>
          {scanning ? (
            <button className="btn-cancel" onClick={stopScan}>스캔 종료</button>
          ) : (
            <button className="btn-primary" onClick={startScan}>📷 스캔 시작</button>
          )}
          {error && <p className="error">{error}</p>}
          {items.length > 0 && (
            <p className="scan-count">인식 {items.length}개 — 결과 탭 확인</p>
          )}
        </div>
      )}

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
