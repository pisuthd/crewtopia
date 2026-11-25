import GuestVoiceRoom from '@/components/Voice/GuestVoiceRoom';

export default async function GuestVoicePage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  return (
    <div className="min-h-screen bg-wfice font-brico text-wfnavy">
      <GuestVoiceRoom linkId={linkId} />
    </div>
  );
}
