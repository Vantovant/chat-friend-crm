import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getDispatchPolicy from "./tools/get-dispatch-policy";
import getDispatcherHealth from "./tools/get-dispatcher-health";
import getMaytapiStatus from "./tools/get-maytapi-status";
import setMaytapiCap from "./tools/set-maytapi-cap";
import setMaytapiFreeze from "./tools/set-maytapi-freeze";
import queueGroupPost from "./tools/queue-group-post";
import getProspectorStatus from "./tools/get-prospector-status";
import listContacts from "./tools/list-contacts";
import getContact from "./tools/get-contact";
import updateContact from "./tools/update-contact";
import addContactNote from "./tools/add-contact-note";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "get-well-hub",
  title: "Get Well Hub",
  version: "1.0.0",
  instructions:
    "Tools for Get Well Hub, a WhatsApp CRM. Call get_dispatch_policy before scheduling any WhatsApp campaign: the dispatcher sends 1 group post per 5-minute tick, so an 11-group wave takes ~55 minutes to clear and final waves must start 60-70 minutes before any time-sensitive event. Posts are queued with status 'pending'. All contact tools act as the signed-in user under row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getDispatchPolicy,
    getDispatcherHealth,
    getMaytapiStatus,
    setMaytapiCap,
    setMaytapiFreeze,
    queueGroupPost,
    getProspectorStatus,
    listContacts,
    getContact,
    updateContact,
    addContactNote,
  ],
});
