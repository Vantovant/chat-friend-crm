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
import createContact from "./tools/create-contact";
import updateContact from "./tools/update-contact";
import addContactNote from "./tools/add-contact-note";
import createPlanTask from "./tools/create-plan-task";
import createPlanMeeting from "./tools/create-plan-meeting";
import createPlanReminder from "./tools/create-plan-reminder";
import sendWhatsappMessage from "./tools/send-whatsapp-message";
import listPlanTasks from "./tools/list-plan-tasks";
import completePlanTask from "./tools/complete-plan-task";
import deletePlanTask from "./tools/delete-plan-task";
import listPlanReminders from "./tools/list-plan-reminders";
import completePlanReminder from "./tools/complete-plan-reminder";
import deletePlanReminder from "./tools/delete-plan-reminder";
import listPlanMeetings from "./tools/list-plan-meetings";
import deletePlanMeeting from "./tools/delete-plan-meeting";
import listConversations from "./tools/list-conversations";
import getConversationThread from "./tools/get-conversation-thread";
import replyToConversation from "./tools/reply-to-conversation";
import listFbComments from "./tools/list-fb-comments";
import getMyBrandLinks from "./tools/get-my-brand-links";
import replyToFbComment from "./tools/reply-to-fb-comment";
import sendPrivateReplyToComment from "./tools/send-private-reply-to-comment";
import createFbPost from "./tools/create-fb-post";
import listFbPosts from "./tools/list-fb-posts";
import getGroupOverview from "./tools/get-group-overview";
import getGroupWelcomeStatus from "./tools/get-group-welcome-status";
import listGroupDmCandidates from "./tools/list-group-dm-candidates";
import createGroupDmBatch from "./tools/create-group-dm-batch";
import approveGroupDmBatch from "./tools/approve-group-dm-batch";
import listGroupMembershipEvents from "./tools/list-group-membership-events";
import listGroupMessages from "./tools/list-group-messages";
import getLeadCallReport from "./tools/get-lead-call-report";
import generateLeadCallSummaries from "./tools/generate-lead-call-summaries";
import listTrainerRules from "./tools/list-trainer-rules";
import getTrainerRule from "./tools/get-trainer-rule";
import createTrainerRule from "./tools/create-trainer-rule";
import updateTrainerRule from "./tools/update-trainer-rule";
import listReplyCorrections from "./tools/list-reply-corrections";
import addReplyCorrection from "./tools/add-reply-correction";
import getTwilioStatus from "./tools/get-twilio-status";
import getGroupGuardStatus from "./tools/get-group-guard-status";
import setGroupGuardMode from "./tools/set-group-guard-mode";
import listCallSheet from "./tools/list-call-sheet";
import getCallSheetCard from "./tools/get-call-sheet-card";
import logCall from "./tools/log-call";
import listCalls from "./tools/list-calls";
import listFollowupsDue from "./tools/list-followups-due";
import getCampaignScorecard from "./tools/get-campaign-scorecard";
import setCallTier from "./tools/set-call-tier";
import addCallSignals from "./tools/add-call-signals";
import saveMessageDrafts from "./tools/save-message-drafts";
import listMessageDrafts from "./tools/list-message-drafts";
import setDraftStatus from "./tools/set-draft-status";
import getCallCampaign from "./tools/get-call-campaign";
import setCallCampaign from "./tools/set-call-campaign";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "get-well-hub",
  title: "Get Well Hub",
  version: "1.16.0",
  instructions:
    "Tools for Get Well Hub, a WhatsApp CRM. Call get_dispatch_policy before scheduling any WhatsApp campaign: the dispatcher sends 1 group post per 5-minute tick, so an 11-group wave takes ~55 minutes to clear and final waves must start 60-70 minutes before any time-sensitive event. Posts are queued with status 'pending'. All contact tools act as the signed-in user under row-level security. For 1:1 inbox work across Twilio and Maytapi, use list_conversations → get_conversation_thread (check recent_auto_reply_events before replying) → reply_to_conversation. For Facebook Page comments, use list_fb_comments to read and reply_to_fb_comment to post a public reply (requires pages_manage_engagement); to privately message a commenter (one private Messenger message per comment, within 7 days of the comment) use send_private_reply_to_comment. For WhatsApp group questions (\"how many people are in the group\") use get_group_overview and get_group_welcome_status; for join/leave/removal history (including people who already left) use list_group_membership_events; for actual group chat content (who said what, when) use list_group_messages; for scoped 1-on-1 group outreach use list_group_dm_candidates → create_group_dm_batch (draft, human review) → approve_group_dm_batch (real sends, requires zazi_group_dm_mode = 'pilot_manual'). For the Lead Call Report, use get_lead_call_report (sorted newest-first by default) and generate_lead_call_summaries to fill in missing AI summaries; edit a lead's type/notes/pipeline stage via update_contact. To post TO a Facebook Page, use create_fb_post — it refuses to do anything unless you pass either scheduled_publish_time (ISO 8601, 10 minutes to 75 days ahead, queued on Facebook's own scheduler) or publish_now: true; never pass publish_now: true unless the user has clearly asked to publish immediately. Use list_fb_posts to see what is already published, scheduled, or failed before adding more. For the AI Trainer (how the auto-reply bot answers), use list_trainer_rules / get_trainer_rule to read, create_trainer_rule / update_trainer_rule to change (no delete — switch off with enabled: false; every edit is audited in the rule's notes), and list_reply_corrections / add_reply_correction for the corrections log. Show the operator the exact rule text and get approval before any trainer write. To check the Twilio pipeline against Twilio's own records (account, balance, webhook, sender status, alerts, and Twilio-vs-Hub inbound counts per day), use get_twilio_status — read-only, admin only. For Group Guard (anti-spam in WhatsApp groups) use get_group_guard_status to read and set_group_guard_mode to change mode. For the Call Sheet (live Hot / Lukewarm / Cold = Tier A / B / C calling list for the active calling campaign), use get_campaign_scorecard for targets, pace and the current time block, list_call_sheet for who to call next, get_call_sheet_card for one person's full context, log_call to record each call (one transaction: call row, activity, dated note line, optional 09:00 SAST reminder), list_calls for the call log and list_followups_due for callbacks (list_call_sheet membership_only: true shows only membership inquiries). Call Sheet writes: set_call_tier (WRITES: tier override, pin, hide — never edits contact temperature), add_call_signals (WRITES: bulk up to 200 signals, matched by phone first, never creates contacts, returns unmatched rows; registered_elsewhere removes the person from the sheet), save_message_drafts (WRITES: bulk up to 100 drafts, status draft, nothing sent), list_message_drafts (read), set_draft_status (WRITES: approved / rejected / sent_by_vanto; approved only with explicit_user_instruction: true after Vanto explicitly says so), get_call_campaign (read) and set_call_campaign (WRITES: targets, blocks, cutoff_at, is_active). Call Sheet safety rules: the Call Sheet tools never send messages; send_whatsapp_message is the only sender, and before any send you must show Vanto the exact text and get a clear yes, and respect its refusals (do-not-contact, frozen outbound, daily cap, 24-hour window). Use supports-language only: no disease or cure claims and no income promises, in messages and in drafts. Health details a prospect shared are for Vanto's call only; never repeat them in messages or drafts. Never change do_not_contact, opt-outs or consent from these tools.",
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
    getLeadCallReport,
    generateLeadCallSummaries,
    getContact,
    createContact,
    updateContact,
    addContactNote,
    createPlanTask,
    createPlanMeeting,
    createPlanReminder,
    sendWhatsappMessage,
    listPlanTasks,
    completePlanTask,
    deletePlanTask,
    listPlanReminders,
    completePlanReminder,
    deletePlanReminder,
    listPlanMeetings,
    deletePlanMeeting,
    listConversations,
    getConversationThread,
    replyToConversation,
    listFbComments,
    getMyBrandLinks,
    replyToFbComment,
    sendPrivateReplyToComment,
    createFbPost,
    listFbPosts,
    getGroupOverview,
    getGroupWelcomeStatus,
    listGroupDmCandidates,
    createGroupDmBatch,
    approveGroupDmBatch,
    listGroupMembershipEvents,
    listGroupMessages,
    listTrainerRules,
    getTrainerRule,
    createTrainerRule,
    updateTrainerRule,
    listReplyCorrections,
    addReplyCorrection,
    getTwilioStatus,
    getGroupGuardStatus,
    setGroupGuardMode,
    listCallSheet,
    getCallSheetCard,
    logCall,
    listCalls,
    listFollowupsDue,
    getCampaignScorecard,
    setCallTier,
    addCallSignals,
    saveMessageDrafts,
    listMessageDrafts,
    setDraftStatus,
    getCallCampaign,
    setCallCampaign,
  ],
});
