import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import './App.css'

function parseLabel(raw) {
  const pn = raw.match(/P(\d{4}-\d{5})/)?.[1] ?? ''
  const sn = raw.match(/S(\d{3}-\d{4}-\d{4})/)?.[1] ?? ''
  const so = raw.match(/1T(.*?)L/)?.[1] ?? ''
  return { pn, sn, so }
}

export default function App() {
  const [scanning, setScanning] = useState(false)
  const [items, setItems]       = useState([])
  const [error, setError]       = useState(null)
  const scannerRef = useRef(null)
  const seenRef    = useRef(new Set())

  const startScan = () => { setError(null); setScanning(true) }
  const stopScan  = () => { scannerRef.current?.stop().catch(() => {}); setScanning(false) }
  const clearAll  = () => { setItems([]); seenRef.current.clear() }

  useEffect(() => {
    if (!scanning) return

    const boxSize = Math.min(window.innerWidth - 40, 280)
    const scanner = new Html5Qrcode('reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ]
    })
    scannerRef.current = scanner

    scanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: boxSize, height: boxSize } },
      (text) => {
        if (seenRef.current.has(text)) return
        seenRef.current.add(text)
        setItems(prev => [...prev, parseLabel(text)])
      },
      () => {}
    ).catch(() => {
      setError('카메라 권한을 허용해주세요.')
      setScanning(false)
    })

    return () => { scanner.stop().catch(() => {}) }
  }, [scanning])

  const handleShare = async () => {
    const text = items.map((it, i) =>
      `${i + 1}. S/N: ${it.sn || '-'} | P/N: ${it.pn || '-'} | S/O: ${it.so || '-'}`
    ).join('\n')
    if (navigator.share) {
      await navigator.share({ text })
    } else {
      await navigator.clipboard.writeText(text)
      alert('클립보드에 복사됐습니다')
    }
  }

  return (
    <div className="app">
      <div className="top-bar">
        <h1>QR 스캐너</h1>
        {items.length > 0 && (
          <div className="top-actions">
            <button className="btn-share" onClick={handleShare}>공유</button>
            <button className="btn-clear" onClick={clearAll}>초기화</button>
          </div>
        )}
      </div>

      {!scanning ? (
        <button className="btn-primary" onClick={startScan}>📷 스캔 시작</button>
      ) : (
        <div className="scanner-wrap">
          <p className="scan-hint">QR을 네모 안에 맞춰주세요</p>
          <div id="reader" />
          <button className="btn-cancel" onClick={stopScan}>스캔 종료</button>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {items.length > 0 && (
        <div className="results">
          <p className="count">인식 {items.length}개</p>
          {[...items].reverse().map((item, i) => (
            <div key={i} className="item">
              <span className="item-num">{items.length - i}</span>
              <div className="item-body">
                <p><b>S/N</b> {item.sn || '—'}</p>
                <p><b>P/N</b> {item.pn || '—'}</p>
                <p><b>S/O</b> {item.so || '—'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
