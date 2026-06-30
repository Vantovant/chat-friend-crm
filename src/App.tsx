import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AcceptInvite from "./pages/AcceptInvite";
import ResetPassword from "./pages/ResetPassword";
import Privacy from "./pages/Privacy";
import Login from "./pages/Login";
import Home from "./pages/marketing/Home";
import Prospector from "./pages/marketing/Prospector";
import Features from "./pages/marketing/Features";
import HowItWorks from "./pages/marketing/HowItWorks";
import Investors from "./pages/marketing/Investors";
import Suite from "./pages/marketing/Suite";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Marketing site */}
          <Route path="/" element={<Home />} />
          <Route path="/prospector" element={<Prospector />} />
          <Route path="/features" element={<Features />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/investors" element={<Investors />} />
          <Route path="/suite" element={<Suite />} />

          {/* Auth */}
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/privacy" element={<Privacy />} />

          {/* App (authenticated) */}
          <Route path="/app" element={<Index />} />
          <Route path="/app/maytapi-inbox" element={<Index />} />
          <Route path="/app/plan" element={<Index />} />
          <Route path="/app/voice-diary" element={<Index />} />

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
