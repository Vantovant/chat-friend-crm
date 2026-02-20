
-- =============================================
-- Vanto Command Hub 2.0 — Full Schema
-- =============================================

-- Enums
CREATE TYPE public.user_role AS ENUM ('agent', 'admin', 'super_admin');
CREATE TYPE public.lead_temperature AS ENUM ('hot', 'warm', 'cold');
CREATE TYPE public.lead_type AS ENUM ('prospect', 'registered', 'buyer', 'vip');
CREATE TYPE public.interest_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE public.message_type AS ENUM ('text', 'image', 'ai');
CREATE TYPE public.message_status AS ENUM ('sent', 'delivered', 'read');
CREATE TYPE public.comm_status AS ENUM ('active', 'closed', 'pending');

-- Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  role public.user_role NOT NULL DEFAULT 'agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pipeline stages
CREATE TABLE public.pipeline_stages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  stage_order INT NOT NULL DEFAULT 0,
  color TEXT DEFAULT 'hsl(172, 66%, 50%)',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contacts
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  temperature public.lead_temperature NOT NULL DEFAULT 'cold',
  lead_type public.lead_type NOT NULL DEFAULT 'prospect',
  interest public.interest_level NOT NULL DEFAULT 'medium',
  tags TEXT[] DEFAULT '{}',
  stage_id UUID REFERENCES public.pipeline_stages(id),
  assigned_to UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INT NOT NULL DEFAULT 0,
  status public.comm_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_outbound BOOLEAN NOT NULL DEFAULT false,
  message_type public.message_type NOT NULL DEFAULT 'text',
  status public.message_status DEFAULT 'sent',
  sent_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Automations
CREATE TABLE public.automations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  action_description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  run_count INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workflows
CREATE TABLE public.workflows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT false,
  steps JSONB NOT NULL DEFAULT '[]',
  contact_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- Helper Functions
-- =============================================

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    'agent'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_automations_updated_at BEFORE UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =============================================
-- Row Level Security
-- =============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

-- Profiles RLS
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Pipeline stages RLS
CREATE POLICY "Anyone authenticated can view stages" ON public.pipeline_stages FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage stages" ON public.pipeline_stages FOR ALL USING (public.is_admin_or_super_admin());

-- Contacts RLS
CREATE POLICY "Admins can view all contacts" ON public.contacts FOR SELECT USING (public.is_admin_or_super_admin());
CREATE POLICY "Agents can view own or unassigned contacts" ON public.contacts FOR SELECT USING (
  auth.uid() IS NOT NULL AND (assigned_to IS NULL OR assigned_to = auth.uid())
);
CREATE POLICY "Authenticated users can insert contacts" ON public.contacts FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can update all contacts" ON public.contacts FOR UPDATE USING (public.is_admin_or_super_admin());
CREATE POLICY "Agents can update own or unassigned contacts" ON public.contacts FOR UPDATE USING (
  auth.uid() IS NOT NULL AND (assigned_to IS NULL OR assigned_to = auth.uid())
);
CREATE POLICY "Admins can delete contacts" ON public.contacts FOR DELETE USING (public.is_admin_or_super_admin());

-- Conversations RLS
CREATE POLICY "Admins can view all conversations" ON public.conversations FOR SELECT USING (public.is_admin_or_super_admin());
CREATE POLICY "Agents can view conversations of own or unassigned contacts" ON public.conversations FOR SELECT USING (
  auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())
  )
);
CREATE POLICY "Authenticated users can create conversations" ON public.conversations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete conversations" ON public.conversations FOR DELETE USING (public.is_admin_or_super_admin());

-- Messages RLS
CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT USING (public.is_admin_or_super_admin());
CREATE POLICY "Agents can view messages of accessible conversations" ON public.messages FOR SELECT USING (
  auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.conversations conv
    JOIN public.contacts c ON c.id = conv.contact_id
    WHERE conv.id = conversation_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())
  )
);
CREATE POLICY "Authenticated users can send messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete messages" ON public.messages FOR DELETE USING (public.is_admin_or_super_admin());

-- Automations RLS
CREATE POLICY "Admins manage automations" ON public.automations FOR ALL USING (public.is_admin_or_super_admin());

-- Workflows RLS
CREATE POLICY "Admins manage workflows" ON public.workflows FOR ALL USING (public.is_admin_or_super_admin());

-- =============================================
-- Seed Data
-- =============================================

INSERT INTO public.pipeline_stages (name, stage_order, color) VALUES
  ('Lead', 1, 'hsl(217, 91%, 60%)'),
  ('Contacted', 2, 'hsl(43, 96%, 56%)'),
  ('Proposal', 3, 'hsl(172, 66%, 50%)'),
  ('Negotiation', 4, 'hsl(27, 96%, 61%)'),
  ('Won', 5, 'hsl(172, 66%, 50%)'),
  ('Lost', 6, 'hsl(0, 84%, 60%)');
