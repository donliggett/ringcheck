import { telnyxLookup } from './telnyx.js';
import { twilioLookup } from './twilio.js';

export const PROVIDER_LOOKUP = { telnyx: telnyxLookup, twilio: twilioLookup };
