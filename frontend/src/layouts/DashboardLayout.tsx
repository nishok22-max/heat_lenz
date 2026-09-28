import { Outlet } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import ChatAssistant from '../components/chat/ChatAssistant'

/** Fixed sidebar on the left; header and the scrolling page on the right. */
export default function DashboardLayout() {
  return (
    <div className="flex h-screen bg-[#F5F7FB] print:block print:h-auto print:bg-white font-sans text-[#13265C] antialiased">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <Header />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 min-[1440px]:px-7 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
      <ChatAssistant audience="authority" />
    </div>
  )
}
