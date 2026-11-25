import type { APIGatewayProxyHandler } from 'aws-lambda';
import { requireAuth } from '../auth/tokens';
import { handleApprovalResolve, handleBotRequestAnswer, handleCrewAddMember, handleCrewChat, handleCrewChatPoll, handleCrewContextClear, handleCrewGates, handleMemberHistory, handlePending, handlePreviewProxy, handlePreviewToken, handleProviders, handleQuestionAnswer, handleCrewFiles, handleCrewFileDownload, handleCrewContextCompact, handleVoiceStatus, handleVoiceToken, handleGuestVoiceToken, handleGuestVoiceConfig, handleGuestLinkCreate, handleGuestLinkGet, handleGuestLinkDelete, handleMcpRelay, handleSandboxBoot, handleSandboxResume, handleSandboxShutdown, handleSandboxStatus, handleSandboxTerminate, handleSandboxToken, handleSandboxFileUpload, handleTeam, handleTeamCreate, handleTeamDelete, handleTeamUpdate, handleTeamsList, handleQuoteCreate, handleVoiceTranscribe } from './handlers';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

// App backend: teams, hire/quote, crew chat, sandbox, preview (REST).
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // ---- REST routes ----
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: CORS, body: '' };
    }
    // Signed preview proxy: token-gated, no session (navigations can't
    // attach a bearer). Scope-bound HMAC verified inside the handler.
    if (event.httpMethod === 'GET' && event.resource === '/rent/preview/{proxy+}') {
      const r = (await handlePreviewProxy(event)) as {
        statusCode: number;
        headers?: Record<string, string>;
        body: string;
        isBase64Encoded?: boolean;
      };
      return {
        statusCode: r.statusCode,
        headers: { ...(r.headers ?? {}), ...CORS },
        body: r.body,
        ...(r.isBase64Encoded ? { isBase64Encoded: true } : {}),
      };
    }
    const ioPrefix = '/rent/io/';
    const ioPath = event.httpMethod !== 'OPTIONS' && event.path.startsWith(ioPrefix)
      ? event.path.slice(ioPrefix.length)
      : null;

    let body: any = {};
    const headers = event.headers as Record<string, string | undefined>;
    const route = `${event.httpMethod} ${event.resource}`;

    if (event.body && ioPath !== 'voice/transcribe') {
      try {
        body = JSON.parse(event.body);
      } catch {
        return json(400, { error: 'body must be JSON' });
      }
    }
    if (ioPath || route.startsWith('GET /rent/') || route.startsWith('POST /rent/') || route.startsWith('PUT /rent/') || route.startsWith('DELETE /rent/')) {
      // Public guest routes carry their own credential (the unguessable
      // linkId) and skip session auth. Everything else needs a session.
      if (ioPath) {
        const ioRoute = `${event.httpMethod} ${ioPath.split('?')[0]}`;
        if (ioRoute === 'GET voice/guest-config') {
          const r = await handleGuestVoiceConfig(event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET voice/guest-token') {
          const r = await handleGuestVoiceToken(event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
      }
      let address: string;
      try {
        address = await requireAuth(headers);
      } catch {
        return json(401, { error: 'missing or invalid session token' });
      }
      // Greedy /rent/io/{proxy+} slot (gateway method cap): in-Lambda routing.
      if (ioPath) {
        const ioRoute = `${event.httpMethod} ${ioPath.split('?')[0]}`;
        // Raw-audio route: body is WAV bytes, not JSON (binaryMediaTypes).
        if (ioRoute === 'POST voice/transcribe') {
          const raw = event.isBase64Encoded
            ? Buffer.from(event.body ?? '', 'base64')
            : Buffer.from(event.body ?? '', 'utf8');
          const ct = String(headers['content-type'] ?? headers['Content-Type'] ?? '');
          const r = await handleVoiceTranscribe(address, raw, ct);
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'POST files/upload') {
          const r = await handleSandboxFileUpload(address, body);
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET providers') {
          const r = await handleProviders(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET voice/status') {
          const r = await handleVoiceStatus(address);
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET voice/token') {
          const r = await handleVoiceToken(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'POST voice/guest-link') {
          const r = await handleGuestLinkCreate(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET voice/guest-link') {
          const r = await handleGuestLinkGet(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'DELETE voice/guest-link') {
          const r = await handleGuestLinkDelete(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET crew/files') {
          const r = await handleCrewFiles(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET crew/files/download') {
          const r = await handleCrewFileDownload(address, event.queryStringParameters ?? {});
          if ('binary' in r) {
            return {
              statusCode: (r as any).statusCode,
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${String((r as any).fileName ?? 'download').replace(/"/g, '')}"`,
                ...CORS,
              },
              body: ((r as any).binary as Buffer).toString('base64'),
              isBase64Encoded: true,
            };
          }
          return json((r as any).statusCode, (r as any).body);
        }
        if (ioRoute === 'POST crew/context/compact') {
          const r = await handleCrewContextCompact(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'GET crew/gates') {
          const r = await handleCrewGates(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        {
          const m = /^POST crew\/gates\/(approvals|questions|bot-requests)\/([A-Za-z0-9_-]+)$/.exec(ioRoute);
          if (m) {
            const r =
              m[1] === 'approvals'
                ? await handleApprovalResolve(address, m[2], body)
                : m[1] === 'questions'
                  ? await handleQuestionAnswer(address, m[2], body)
                  : await handleBotRequestAnswer(address, m[2], body);
            return json(r.statusCode, r.body);
          }
        }
        if (ioRoute === 'DELETE crew/context') {
          const r = await handleCrewContextClear(address, event.queryStringParameters ?? {});
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'POST crew/add-member') {
          const r = await handleCrewAddMember(address, body);
          return json(r.statusCode, r.body);
        }
        if (ioRoute === 'POST mcp') {
          const r = await handleMcpRelay(address, body);
          return json(r.statusCode, r.body);
        }
        return json(404, { error: 'unknown route' });
      }
      if (route === 'GET /rent/pending') {
        const r = await handlePending(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/messages') {
        const r = await handleMemberHistory(address, event.queryStringParameters ?? {});
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/team') {
        const r = await handleTeam(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/teams') {
        const r = await handleTeamsList(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/teams') {
        // Modal-direct hire shares this slot (Lambda policy size caps new
        // methods): { action: 'quote', teamId, minutes, brief? } → quote.
        if (body?.action === 'quote') {
          const r = await handleQuoteCreate(address, body);
          return json(r.statusCode, r.body);
        }
        const r = await handleTeamCreate(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'PUT /rent/teams') {
        const r = await handleTeamUpdate(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'DELETE /rent/teams') {
        const r = await handleTeamDelete(address, event.queryStringParameters ?? {});
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/crew/chat') {
        const r = await handleCrewChat(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/crew/chat') {
        const r = await handleCrewChatPoll(address, event.queryStringParameters ?? {});
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/sandbox/suspend') {
        const r = await handleSandboxShutdown(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/sandbox/terminate') {
        const r = await handleSandboxTerminate(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/preview/token') {
        const r = await handlePreviewToken(address, body);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/sandbox/boot') {
        const r = await handleSandboxBoot(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'GET /rent/sandbox/status') {
        const r = await handleSandboxStatus(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/sandbox/resume') {
        const r = await handleSandboxResume(address);
        return json(r.statusCode, r.body);
      }
      if (route === 'POST /rent/sandbox/token') {
        const r = await handleSandboxToken(address);
        return json(r.statusCode, r.body);
      }
      return json(404, { error: 'unknown route' });
    }
    return json(404, { error: 'unknown route' });
  } catch (e) {
    console.error('[app] handler failed:', e);
    return json(500, { error: 'request failed' });
  }
};
