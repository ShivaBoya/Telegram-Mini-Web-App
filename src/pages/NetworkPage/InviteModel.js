import { useEffect, useState } from "react"
import { useReferral } from "../../reactContext/ReferralContext"

const InviteModal = ({ isOpen, onClose }) => {
  const { inviteLink, shareToTelegram, copyToClipboard } = useReferral()
  const [copied, setCopied] = useState(false)

  const tg = window.Telegram?.WebApp

  // Close modal when Escape key is pressed
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [isOpen, onClose])

  // Prevent scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "auto"
    }

    return () => {
      document.body.style.overflow = "auto"
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleCopy = async () => {
    const success = await copyToClipboard()
    if (success) {
      setCopied(true)
      if (tg?.showPopup) {
        tg.showPopup({
          title: "Success",
          message: "Invite link copied!",
          buttons: [{ type: "ok" }]
        })
      }
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleTelegramShare = () => {
    shareToTelegram()
    onClose()
  }

  // 🔥 FIXED WHATSAPP SHARE (Telegram Safe)
  const handleWhatsAppShare = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(
      `Join me and earn rewards! ${inviteLink}`
    )}`

    if (tg?.openLink) {
      tg.openLink(url) // Works inside Telegram
    } else {
      window.open(url, "_blank") // Browser fallback
    }

    onClose()
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white/10 backdrop-blur-sm px-5 py-5 rounded-lg shadow-lg max-w-md w-full">

        <div className="flex justify-between items-center mb-6">
          <div className="text-2xl font-semibold text-gray-100">
            Invite a friend
          </div>
          <button
            className="text-gray-100 hover:text-red-500 text-2xl font-bold"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex justify-center mb-6">
          {inviteLink ? (
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(inviteLink)}`}
              alt="QR Code"
              className="w-60 h-60 sm:w-64 sm:h-64 rounded-lg"
            />
          ) : (
            <div className="w-60 h-60 sm:w-64 sm:h-64 rounded-lg bg-gray-700 flex items-center justify-center text-gray-400">
              Unavailable
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">

          <button
            className="bg-blue-500/20 px-3 text-white py-2 h-12 font-bold rounded hover:bg-blue-500/30 transition-colors"
            onClick={handleTelegramShare}
          >
            Telegram
          </button>

          <button
            className="bg-green-500/20 px-3 text-white py-2 h-12 font-bold rounded hover:bg-green-500/30 transition-colors"
            onClick={handleWhatsAppShare}
          >
            WhatsApp
          </button>

          <button
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-2 h-12 font-bold rounded hover:from-indigo-600 hover:to-purple-700 transition-colors"
            onClick={handleCopy}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>

          <button
            className="w-full text-white border-white/20 bg-white/5 py-3 hover:bg-white/10 font-bold rounded transition-colors"
            onClick={onClose}
          >
            Close
          </button>

        </div>
      </div>
    </div>
  )
}

export default InviteModal
