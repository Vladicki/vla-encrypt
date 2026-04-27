import { useEffect, useMemo, useRef, useState } from 'react'
import { WindowCenter, WindowSetSize } from '../wailsjs/runtime/runtime'
import { DecryptFileInPlace, EncryptFileInPlace, PickFile } from '../wailsjs/go/main/App'

const LOG_STORAGE_KEY = 'vla-encrypt-log'
const INVALID_FILE_MESSAGE = 'Input file path is invalid.'

const formatTimestamp = (value) =>
    new Date(value).toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })

const createActivityEntry = (level, message, target = '') => ({
    id: `${level}-${message}-${target}-${Date.now()}`,
    level,
    message,
    target,
    createdAt: new Date().toISOString(),
})

const getFileNameFromPath = (path) => {
    const normalizedPath = `${path || ''}`.replace(/\\/g, '/')
    const segments = normalizedPath.split('/')
    return segments[segments.length - 1] || path
}

function FileSelector({
    file,
    dragging,
    onBrowse,
    onDropPath,
    onDiscard,
    onEncrypt,
    onDecrypt,
    onDragStateChange,
}) {
    const handleDrop = (event) => {
        event.preventDefault()
        onDragStateChange(false)

        const filePath = event.dataTransfer?.files?.[0]?.path
        if (!filePath) {
            onDropPath('', INVALID_FILE_MESSAGE)
            return
        }

        onDropPath(filePath, '')
    }

    return (
        <div className="rounded-[24px] border border-stone-700 bg-stone-900/80 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-stone-200">File Select</h2>
                <div className="flex items-center gap-2">
                    {file ? (
                        <button
                            type="button"
                            onClick={onDiscard}
                            className="rounded-full border border-stone-700 bg-[#121110] px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                        >
                            X Discard
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onEncrypt}
                        className="rounded-full border border-stone-600 bg-stone-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-100 transition hover:border-stone-500 hover:bg-stone-700"
                    >
                        Encrypt
                    </button>
                    <button
                        type="button"
                        onClick={onDecrypt}
                        className="rounded-full border border-stone-600 bg-stone-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-100 transition hover:border-stone-500 hover:bg-stone-700"
                    >
                        Decrypt
                    </button>
                </div>
            </div>

            <button
                type="button"
                onClick={onBrowse}
                onDragOver={(event) => {
                    event.preventDefault()
                    onDragStateChange(true)
                }}
                onDragLeave={() => onDragStateChange(false)}
                onDrop={handleDrop}
                className={`flex min-h-[200px] w-full flex-col items-center justify-center rounded-[20px] border border-dashed px-6 py-8 text-center transition ${dragging
                        ? 'border-stone-300 bg-stone-800'
                        : 'border-stone-700 bg-stone-950/60 hover:border-stone-500 hover:bg-stone-900'
                    }`}
            >
                <span className="text-sm font-medium uppercase tracking-[0.24em] text-stone-400">File Select</span>
                <span className="mt-4 text-base font-medium text-stone-100">
                    {file ? file.name : 'Drop file or browse location'}
                </span>
                {file ? <span className="mt-2 break-all text-xs text-stone-500">{file.path}</span> : null}
            </button>
        </div>
    )
}

function App() {
    const keyInputRef = useRef(null)
    const shellRef = useRef(null)
    const keyTypedLoggedRef = useRef(false)
    const [selectedFile, setSelectedFile] = useState(null)
    const [keyValue, setKeyValue] = useState('')
    const [showKeyValue, setShowKeyValue] = useState(false)
    const [generatedKey, setGeneratedKey] = useState('')
    const [notice, setNotice] = useState('')
    const [noticeTone, setNoticeTone] = useState('info')
    const [fileDragging, setFileDragging] = useState(false)
    const [confirmDialog, setConfirmDialog] = useState(null)
    const [logEntries, setLogEntries] = useState(() => {
        try {
            const saved = localStorage.getItem(LOG_STORAGE_KEY)
            if (!saved) return []

            const parsed = JSON.parse(saved)
            if (!Array.isArray(parsed)) {
                return []
            }

            return parsed.map((entry) => ({
                id: entry.id || `${entry.level || 'INFO'}-${entry.message || entry.filename || 'activity'}-${entry.createdAt || Date.now()}`,
                level: entry.level || 'INFO',
                message: entry.message || entry.filename || 'Activity',
                target: entry.target || '',
                createdAt: entry.createdAt || new Date().toISOString(),
            }))
        } catch {
            localStorage.removeItem(LOG_STORAGE_KEY)
            return []
        }
    })

    useEffect(() => {
        localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logEntries))
    }, [logEntries])

    useEffect(() => {
        // The window tracks rendered content so the desktop shell stays close to the app's natural size.
        const resizeWindowToContent = () => {
            if (!shellRef.current) {
                return
            }

            const contentWidth = Math.ceil(shellRef.current.offsetWidth + 32)
            const contentHeight = Math.ceil(shellRef.current.offsetHeight + 80)
            const nextWidth = Math.max(980, contentWidth)
            const nextHeight = Math.max(760, contentHeight)

            WindowSetSize(nextWidth, nextHeight)
            WindowCenter()
        }

        resizeWindowToContent()
        const timeoutId = window.setTimeout(resizeWindowToContent, 50)
        window.addEventListener('resize', resizeWindowToContent)

        return () => {
            window.clearTimeout(timeoutId)
            window.removeEventListener('resize', resizeWindowToContent)
        }
    }, [generatedKey, logEntries.length, notice, selectedFile])

    const noticeClassName = useMemo(() => {
        if (noticeTone === 'error') {
            return 'border-red-900/60 bg-red-950/40 text-red-200'
        }

        if (noticeTone === 'success') {
            return 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200'
        }

        return 'border-stone-700 bg-stone-900/70 text-stone-300'
    }, [noticeTone])

    const appendLog = async (level, message, target = '') => {
        const entry = createActivityEntry(level, message, target)
        setLogEntries((current) => [entry, ...current].slice(0, 80))

        const logger = window?.go?.main?.App?.AppendActivityLog
        if (typeof logger === 'function') {
            try {
                await logger(level, message, target)
            } catch {
                setLogEntries((current) => [createActivityEntry('ERROR', 'log file write failed', '.log'), ...current].slice(0, 80))
            }
        }
    }

    const appendEntropyLogs = (entries) => {
        setLogEntries((current) => {
            const nextEntries = (entries || []).map((entry) => createActivityEntry(entry.level || 'INFO', entry.message || '[entropy]', entry.target || 'key'))
            return [...nextEntries.reverse(), ...current].slice(0, 80)
        })
    }

    const updateSelectedFile = (path, message) => {
        setSelectedFile(path ? { path, name: getFileNameFromPath(path) } : null)

        if (message) {
            setNoticeTone('error')
            setNotice(message)
            void appendLog('ERROR', 'invalid file path', 'file')
            return
        }

        if (path) {
            const name = getFileNameFromPath(path)
            setNoticeTone('info')
            setNotice(`Ready for ${name}. Encrypt or decrypt.`)
            void appendLog('INFO', 'file selected', path)
        }
    }

    const browseForFile = async () => {
        try {
            const selection = await PickFile()
            if (!selection?.path) {
                return
            }
            updateSelectedFile(selection.path, '')
        } catch (error) {
            console.error(error)
            setNoticeTone('error')
            setNotice('File selection failed.')
            void appendLog('ERROR', 'file selection failed', 'file')
        }
    }

    const openConfirmDialog = (mode, fileName, onConfirm) => {
        // The browser confirm dialog cannot be styled, so the app uses a custom modal.
        setConfirmDialog({
            title: `${mode} File`,
            message: `${mode.toLowerCase()} will overwrite ${fileName} at its current location. Continue?`,
            onConfirm,
        })
    }

    const closeConfirmDialog = () => {
        setConfirmDialog(null)
    }

    const closeGeneratedKey = () => {
        setGeneratedKey('')
    }

    const copyGeneratedKey = async () => {
        if (!generatedKey) {
            return
        }

        try {
            if (typeof window !== 'undefined' && window.go?.main?.App?.SetClipboardText) {
                await window.go.main.App.SetClipboardText(generatedKey)
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(generatedKey)
            } else {
                throw new Error('clipboard unavailable')
            }
            setNoticeTone('success')
            setNotice('Generated encryption key copied.')
            void appendLog('SUCCESS', 'generated key copied', 'clipboard')
            closeGeneratedKey()
        } catch (error) {
            console.error(error)
            setNoticeTone('error')
            setNotice('Failed to copy generated key.')
            void appendLog('ERROR', 'generated key copy failed', 'clipboard')
        }
    }

    const runEncrypt = async () => {
        try {
            setGeneratedKey('')
            setNoticeTone('info')
            setNotice(`Encrypting ${selectedFile.name} in place...`)
            void appendLog('INFO', 'encryption started', selectedFile.path)

            const result = await EncryptFileInPlace(selectedFile.path, keyValue)
            appendEntropyLogs(result?.entropyLogs)

            if (result?.generatedKey) {
                setGeneratedKey(result.generatedKey)
            }

            setNoticeTone('success')
            setNotice(`Encrypted ${selectedFile.name} in place. Save generated key.`)
            void appendLog('SUCCESS', 'encryption completed', selectedFile.path)
        } catch (error) {
            console.error(error)
            setNoticeTone('error')
            setNotice(`Encryption failed: ${error}`)
            void appendLog('ERROR', 'encryption failed', selectedFile.path)
        }
    }

    const handleEncrypt = async () => {
        if (!selectedFile?.path) {
            setNoticeTone('error')
            setNotice(INVALID_FILE_MESSAGE)
            void appendLog('ERROR', 'encrypt failed', 'no file')
            return
        }

        openConfirmDialog('Encrypt', selectedFile.name, runEncrypt)
    }

    const runDecrypt = async () => {
        try {
            setNoticeTone('info')
            setNotice(`Decrypting ${selectedFile.name} in place...`)
            void appendLog('INFO', 'decryption started', selectedFile.path)

            await DecryptFileInPlace(selectedFile.path, keyValue)
            setNoticeTone('success')
            setNotice(`Decrypted ${selectedFile.name} in place.`)
            void appendLog('SUCCESS', 'decryption completed', selectedFile.path)
        } catch (error) {
            console.error(error)
            setNoticeTone('error')
            setNotice(`Decryption failed: ${error}`)
            void appendLog('ERROR', 'decryption failed', selectedFile.path)
        }
    }

    const handleDecrypt = async () => {
        if (!selectedFile?.path) {
            setNoticeTone('error')
            setNotice(INVALID_FILE_MESSAGE)
            void appendLog('ERROR', 'decrypt failed', 'no file')
            return
        }

        if (!keyValue.trim()) {
            setNoticeTone('error')
            setNotice('Enter key before decryption starts.')
            keyInputRef.current?.focus()
            void appendLog('ERROR', 'missing key', selectedFile.name)
            return
        }

        openConfirmDialog('Decrypt', selectedFile.name, runDecrypt)
    }

    const handleDiscard = () => {
        if (selectedFile) {
            void appendLog('INFO', 'file discarded', selectedFile.path)
        }
        setSelectedFile(null)
        setNoticeTone('info')
        setNotice('File discarded.')
    }

    const handlePasteFromClipboard = async () => {
        // Wails clipboard access is more reliable than browser clipboard in the desktop shell.
        try {
            let clipboardText = ''

            if (typeof window !== 'undefined' && window.go?.main?.App?.GetClipboardText) {
                clipboardText = await window.go.main.App.GetClipboardText()
            }

            if (!clipboardText.trim() && navigator.clipboard?.readText) {
                try {
                    clipboardText = await navigator.clipboard.readText()
                } catch {
                    clipboardText = ''
                }
            }

            if (!clipboardText.trim()) {
                setNoticeTone('info')
                setNotice('Clipboard has no text.')
                void appendLog('INFO', 'clipboard has no text', 'key')
                return
            }

            keyTypedLoggedRef.current = true
            setKeyValue(clipboardText)
            setNoticeTone('success')
            setNotice('Key pasted from clipboard.')
            void appendLog('SUCCESS', 'key pasted', 'clipboard')
        } catch (error) {
            console.error(error)
            setNoticeTone('error')
            setNotice('Clipboard access failed.')
            void appendLog('ERROR', 'clipboard access failed', 'key')
        }
    }

    const handleKeyValueChange = (event) => {
        const nextValue = event.target.value
        setKeyValue(nextValue)

        if (!nextValue.trim()) {
            keyTypedLoggedRef.current = false
            return
        }

        if (!keyTypedLoggedRef.current) {
            keyTypedLoggedRef.current = true
            void appendLog('INFO', 'key entered', 'manual input')
        }
    }

    return (
        <div className="min-h-screen bg-[#191715] px-4 py-10 text-stone-100">
            <div ref={shellRef} className="mx-auto w-full max-w-6xl rounded-[32px] border border-stone-800 bg-[#211f1c] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] md:p-8">
                <div className="mb-8">
                    <h1 className="text-3xl font-semibold tracking-[-0.03em] text-stone-100 md:text-4xl">Encryption Menu</h1>
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
                    <FileSelector
                        file={selectedFile}
                        dragging={fileDragging}
                        onBrowse={browseForFile}
                        onDropPath={updateSelectedFile}
                        onDiscard={handleDiscard}
                        onEncrypt={handleEncrypt}
                        onDecrypt={handleDecrypt}
                        onDragStateChange={setFileDragging}
                    />

                    <div className="min-h-[252px] rounded-[24px] border border-stone-800 bg-[#1b1917] p-5">
                        <div className="flex items-center justify-between gap-3">
                            <label htmlFor="keyValue" className="text-sm font-medium uppercase tracking-[0.22em] text-stone-300">
                                Key
                            </label>
                            <button
                                type="button"
                                onClick={handlePasteFromClipboard}
                                className="rounded-full border border-stone-700 bg-[#121110] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                            >
                                Paste Clipboard
                            </button>
                        </div>
                        <div className="mt-4 flex items-center gap-2 rounded-[18px] border border-stone-700 bg-[#121110] px-4 py-3">
                            <input
                                ref={keyInputRef}
                                id="keyValue"
                                type={showKeyValue ? 'text' : 'password'}
                                value={keyValue}
                                onChange={handleKeyValueChange}
                                placeholder="Optional on encrypt. Required on decrypt."
                                className="w-full bg-transparent text-sm text-stone-100 outline-none placeholder:text-stone-600"
                            />
                            <button
                                type="button"
                                onClick={() => setShowKeyValue((current) => !current)}
                                className="shrink-0 text-stone-400 transition hover:text-stone-100"
                                aria-label={showKeyValue ? 'Hide key' : 'Show key'}
                                title={showKeyValue ? 'Hide key' : 'Show key'}
                            >
                                {showKeyValue ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className="h-4 w-4 fill-current">
                                        <path d="M73 39.1C63.6 29.7 48.4 29.7 39.1 39.1C29.8 48.5 29.7 63.7 39 73.1L567 601.1C576.4 610.5 591.6 610.5 600.9 601.1C610.2 591.7 610.3 576.5 600.9 567.2L504.5 470.8C507.2 468.4 509.9 466 512.5 463.6C559.3 420.1 590.6 368.2 605.5 332.5C608.8 324.6 608.8 315.8 605.5 307.9C590.6 272.2 559.3 220.2 512.5 176.8C465.4 133.1 400.7 96.2 319.9 96.2C263.1 96.2 214.3 114.4 173.9 140.4L73 39.1zM236.5 202.7C260 185.9 288.9 176 320 176C399.5 176 464 240.5 464 320C464 351.1 454.1 379.9 437.3 403.5L402.6 368.8C415.3 347.4 419.6 321.1 412.7 295.1C399 243.9 346.3 213.5 295.1 227.2C286.5 229.5 278.4 232.9 271.1 237.2L236.4 202.5zM357.3 459.1C345.4 462.3 332.9 464 320 464C240.5 464 176 399.5 176 320C176 307.1 177.7 294.6 180.9 282.7L101.4 203.2C68.8 240 46.4 279 34.5 307.7C31.2 315.6 31.2 324.4 34.5 332.3C49.4 368 80.7 420 127.5 463.4C174.6 507.1 239.3 544 320.1 544C357.4 544 391.3 536.1 421.6 523.4L357.4 459.2z" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" className="h-4 w-4 fill-current">
                                        <path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z" />
                                    </svg>
                                )}
                            </button>
                        </div>

                        <div className={`mt-4 rounded-[18px] border px-4 py-3 text-sm ${noticeClassName}`}>
                            {notice || 'Status bar'}
                        </div>
                    </div>
                </div>

                <div className="mt-5 rounded-[24px] border border-stone-800 bg-[#1b1917] p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-stone-200">Live Activity Log</h2>
                        <button
                            type="button"
                            onClick={() => setLogEntries([])}
                            className="rounded-full border border-stone-700 bg-[#121110] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                        >
                            Clear
                        </button>
                    </div>

                    <div className="h-[220px] space-y-2 overflow-y-auto pr-1">
                        {logEntries.length ? (
                            logEntries.map((entry) => (
                                <div key={entry.id} className="rounded-[14px] border border-stone-800 bg-[#121110] px-3 py-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] ${entry.level === 'ERROR'
                                                            ? 'bg-red-950/60 text-red-200'
                                                            : entry.level === 'SUCCESS'
                                                                ? 'bg-emerald-950/50 text-emerald-200'
                                                                : 'bg-stone-800 text-stone-300'
                                                        }`}
                                                >
                                                    {entry.level}
                                                </span>
                                                <p className="truncate text-sm font-medium text-stone-100">{entry.message}</p>
                                            </div>
                                            {entry.target ? <p className="mt-1 break-all text-xs text-stone-500">{entry.target}</p> : null}
                                        </div>
                                        <span className="shrink-0 text-xs text-stone-500">{formatTimestamp(entry.createdAt)}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="rounded-[14px] border border-dashed border-stone-700 bg-[#121110] px-3 py-4 text-sm text-stone-500">
                                Empty
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {confirmDialog ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
                    <div className="w-full max-w-lg rounded-[28px] border border-stone-700 bg-[#1b1917] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-stone-200">{confirmDialog.title}</h2>
                        </div>
                        <p className="mt-4 text-sm text-stone-300">{confirmDialog.message}</p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeConfirmDialog}
                                className="rounded-full border border-stone-700 bg-[#121110] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const nextAction = confirmDialog.onConfirm
                                    closeConfirmDialog()
                                    void nextAction()
                                }}
                                className="rounded-full border border-stone-600 bg-stone-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-100 transition hover:border-stone-500 hover:bg-stone-700"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {generatedKey ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
                    <div className="w-full max-w-xl rounded-[28px] border border-stone-700 bg-[#1b1917] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-stone-200">Generated Encryption Key</h2>
                            <button
                                type="button"
                                onClick={closeGeneratedKey}
                                className="rounded-full border border-stone-700 bg-[#121110] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                            >
                                Close
                            </button>
                        </div>
                        <p className="mt-4 text-sm text-stone-400">Copy and save this key. Decryption needs this exact value.</p>
                        <div className="mt-4 rounded-[18px] border border-stone-700 bg-[#121110] px-4 py-4">
                            <p className="break-all text-sm text-stone-100">{generatedKey}</p>
                        </div>
                        <div className="mt-5 flex justify-end">
                            <button
                                type="button"
                                onClick={copyGeneratedKey}
                                className="rounded-full border border-stone-600 bg-stone-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-100 transition hover:border-stone-500 hover:bg-stone-700"
                            >
                                Copy
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default App
