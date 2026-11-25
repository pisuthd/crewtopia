import VoiceRoom from '@/components/Voice/VoiceRoom';
import { WalletProvider } from '@/components/App/WalletContext';
import { SessionProvider } from '@/components/App/SessionContext';

export default async function VoicePage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return (
    <WalletProvider>
      <SessionProvider>
        <div className="flex min-h-screen bg-wfice font-brico text-wfnavy">
          <VoiceRoom taskId={taskId} />
        </div>
      </SessionProvider>
    </WalletProvider>
  );
}
