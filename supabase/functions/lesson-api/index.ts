import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Google Service Account helpers ---

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getGoogleAccessToken(key: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const signingInput = `${header}.${payload}`

  const pemContent = key.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const der = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )

  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', privateKey,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${base64url(new Uint8Array(sigBytes))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Google token error: ${JSON.stringify(data)}`)
  return data.access_token
}

// --- Main handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'lesson_prep'

  if (action === 'lesson_prep') {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, topic, lesson_date, doc_url')
      .order('created_at', { ascending: false })
      .limit(5)

    const latest = lessons?.[0] || null
    const prev = lessons?.[1] || null

    const { data: homework } = await supabase
      .from('homework')
      .select('id, lesson_id, description, due_date, url')
      .order('created_at', { ascending: false })
      .limit(20)

    const prevVocab = prev ? (await supabase
      .from('vocabulary')
      .select('word, definition, example')
      .eq('lesson_id', prev.id)
      .limit(40)).data : []

    return new Response(JSON.stringify({ latest, prev, homework: homework || [], prevVocab: prevVocab || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (action === 'vocabulary') {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, topic')
      .order('created_at', { ascending: false })

    const { data: vocab } = await supabase
      .from('vocabulary')
      .select('word, definition, example, lesson_id')
      .order('word', { ascending: true })
      .limit(1000)

    return new Response(JSON.stringify({ lessons: lessons || [], vocab: vocab || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (action === 'next_lesson') {
    try {
      const keyJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')
      if (!keyJson) {
        return new Response(JSON.stringify({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY not configured' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const serviceAccountKey = JSON.parse(keyJson)
      const accessToken = await getGoogleAccessToken(serviceAccountKey)
      // 'primary' means the service account's own calendar (empty).
      // Must use the calendar owner's email for a shared calendar.
      const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') || 'elenipster@gmail.com'

      const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        q: 'english',
        orderBy: 'startTime',
        singleEvents: 'true',
        maxResults: '1',
      })

      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const calData = await calRes.json()
      const event = calData.items?.[0] ?? null

      return new Response(JSON.stringify({
        next_lesson: event ? {
          date: event.start.dateTime || event.start.date,
          title: event.summary,
          meet_link: event.hangoutLink ??
            event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ??
            null,
        } : null
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  return new Response(JSON.stringify({ error: 'unknown action' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
