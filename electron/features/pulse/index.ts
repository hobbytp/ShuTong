/**
 * Pulse Feature Module
 * 
 * AI-powered insights and research capabilities.
 */

// Pulse Agent
export { PulseAgent, pulseAgent } from './agent/pulse-agent';
export type { PulseState } from './agent/schema';

// Research
export {
    computeScopeScore, discardDeliverable, dismissResearchProposal, generateQueryVariants, generateResearchProposalCard, runFastResearch,
    saveDeliverable, startResearchFromProposal
} from './research/pulse-research';

export type {
    DeliverableContent, ResearchDeliverables, ResearchMode,
    ResearchProposalContent
} from './research/pulse-research';

