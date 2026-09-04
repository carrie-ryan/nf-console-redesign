import { Component, Input, computed, signal } from '@angular/core';

/** A conceptual-help topic: a plain-language "what/why/how it fits" explainer. */
interface HelpTopic {
  /** Big lead question, e.g. "What is an identity?" */
  lead: string;
  /** One or two intro paragraphs answering the lead. */
  intro: string[];
  /** Short, scannable key points. */
  keyPoints: { icon: string; title: string; body: string }[];
  /** Closing "how it fits the bigger picture" paragraph. */
  howItFits: string;
}

/**
 * Body for the 'onboarding-help' drawer. Renders a CONCEPTUAL explainer (not the
 * step-by-step how-to) for an onboarding topic, in the style of Customer
 * Connect's concept drawers: a lead question, key points, and how it fits.
 * Keyed by `topic` so later steps can add their own concepts.
 */
type HelpTopicKey = 'identity' | 'router' | 'service' | 'advanced-service' | 'policy' | 'router-policy' | 'verify';

@Component({
  selector: 'app-onboarding-help-content',
  standalone: true,
  templateUrl: './onboarding-help-content.component.html',
  styleUrl: './onboarding-help-content.component.css',
})
export class OnboardingHelpContentComponent {
  private readonly _topic = signal<HelpTopicKey>('identity');

  @Input({ required: true })
  set topic(value: HelpTopicKey) {
    this._topic.set(value);
  }

  readonly content = computed<HelpTopic>(() => TOPICS[this._topic()]);
}

const TOPICS: Record<HelpTopicKey, HelpTopic> = {
  identity: {
    lead: 'What is an identity?',
    intro: [
      'An identity is how your network recognizes a single participant — a person, a device, or a piece of software. Every laptop, phone, server, or app that connects to your network is represented by its own identity.',
      'Because zero-trust access is granted to identities (never to IP addresses or network locations), the identity is the thing your policies actually authorize. Nothing reaches a service until an identity is allowed to.',
    ],
    keyPoints: [
      {
        icon: 'fa-solid fa-fingerprint',
        title: 'One identity per participant',
        body: 'Each user, device, or workload gets its own identity, so access can be granted — or revoked — one participant at a time.',
      },
      {
        icon: 'fa-solid fa-hashtag',
        title: 'Attributes group identities',
        body: 'Role attributes (like #get-started-client) tag identities so policies can target a whole group by attribute instead of naming each one.',
      },
      {
        icon: 'fa-solid fa-key',
        title: 'Enrollment proves who it is',
        body: 'A new identity is issued a one-time enrollment token (a JWT). Enrolling it in a tunneler app exchanges that token for a strong cryptographic key — no passwords, no shared secrets.',
      },
    ],
    howItFits:
      'Identity is the first building block of the flow: you enroll it here, then a router carries its traffic, a service defines what it can reach, and policies decide whether the two are allowed to connect. Get the identity right and the rest of the setup has something concrete to authorize.',
  },
  router: {
    lead: 'What is a router?',
    intro: [
      'A router (an edge router) is the zero-trust relay that actually moves traffic across your network. It is the on-ramp and off-ramp of the fabric: identities connect to a nearby router, and routers carry that traffic securely to wherever the target service lives.',
      'Routers link together to form the fabric — a mesh of relay nodes. Traffic rides encrypted between them and only leaves at a router authorized to reach the service, so nothing is ever exposed on the open internet.',
    ],
    keyPoints: [
      {
        icon: 'fa-solid fa-diagram-project',
        title: 'Relays traffic across the fabric',
        body: 'Routers pass encrypted traffic between one another along an efficient path, so a client in one place can reach a service somewhere else — no VPN, no public exposure.',
      },
      {
        icon: 'fa-solid fa-arrow-right-from-bracket',
        title: 'Egress happens at the router',
        body: 'The router nearest the target service is where traffic exits the fabric to reach it. Which routers may egress to which services is decided by policy, not by the network.',
      },
      {
        icon: 'fa-solid fa-server',
        title: 'Customer-hosted or NetFoundry-hosted',
        body: 'You can run a router on your own machine (you deploy it with a registration key) or let NetFoundry provision one in its fabric — the role is the same either way.',
      },
    ],
    howItFits:
      'The router is the second building block: once an identity exists, it needs a router to carry its traffic. Next you will define a service — what that traffic is allowed to reach — and then policies that authorize which identities may dial it and which routers may carry it. Without a router in place, an identity has nothing to connect through.',
  },
  service: {
    lead: 'What is a service?',
    intro: [
      'A service defines an application resource on your network — a web app, an API, a database, an SSH host — and, just as importantly, who is allowed to reach it and who is allowed to provide it. It is the "what" of zero-trust access: the thing traffic is ultimately destined for.',
      'A service stays dark until policy authorizes it. Two sides have to line up: an identity must be granted access to dial the service, and a hosting identity must be allowed to bind (provide) it. Only then can a client connect — and only through the fabric, never over the open internet.',
    ],
    keyPoints: [
      {
        icon: 'fa-solid fa-right-left',
        title: 'Accessing vs. hosting',
        body: 'The accessing side sets how clients reach the service — the intercept address and port, and which identities may dial it. The hosting side sets where traffic is really sent, and which identities may host it.',
      },
      {
        icon: 'fa-solid fa-hashtag',
        title: 'Attributes target policies',
        body: 'Role attributes on the service and on identities (like #prod-db or #db-clients) let policies grant access to a whole group at once, instead of naming each service or identity one by one.',
      },
      {
        icon: 'fa-solid fa-wand-magic-sparkles',
        title: 'Simple auto-creates the policies',
        body: 'On the Simple path, the identities you pick for accessing and hosting are turned into a dial policy and a bind policy for you — so you skip authoring service policies by hand.',
      },
    ],
    howItFits:
      'The service is the third building block: your identity exists, a router carries its traffic, and now the service defines what that traffic can reach. Policies do the authorizing — which identities may dial it and which may host it. Because the Simple path generates those two service policies for you, the only policy left to set is the Router Policy (which lets a router carry the service), and then you verify traffic flows.',
  },
  'advanced-service': {
    lead: 'What does the Advanced path add?',
    intro: [
      'Under the covers, every service is made of configurations — small typed documents that describe one aspect of the service. The Simple path writes these for you from a few fields; the Advanced path lets you author and attach each configuration by hand, so you can express things Simple can\'t (multiple addresses, port ranges, health checks, forwarding, custom listen options).',
      'The two configs that matter most are the pair Simple always creates: an intercept config for the client access side (what address and ports clients dial) and a host config for the hosting side (where the hosting identity actually sends the traffic). A working service needs both.',
    ],
    keyPoints: [
      {
        icon: 'fa-solid fa-arrow-right-to-bracket',
        title: 'intercept.v1 — the access side',
        body: 'Defines the address(es) and port ranges clients use to reach the service. It is the advanced equivalent of Simple\'s "how will the service be accessed?" — the client-facing intercept.',
      },
      {
        icon: 'fa-solid fa-arrow-right-from-bracket',
        title: 'host.v1 — the hosting side',
        body: 'Defines where a hosting identity forwards the traffic — the protocol, address, and port (plus optional forwarding, health checks, and proxy). It is the advanced equivalent of "where should traffic be sent?".',
      },
      {
        icon: 'fa-solid fa-sliders',
        title: 'You define the policies yourself',
        body: 'Advanced does not auto-generate policies. After saving the service you author the Service Policy, Edge Router Policy, and Service Edge Router Policy by hand — which is exactly the trade-off for the extra control.',
      },
    ],
    howItFits:
      'Advanced and Simple produce the same kind of service — the difference is who writes the pieces. Configs map onto the service as its access and hosting definitions; policies then authorize it. Because you attached the configs by hand here, the flow does not skip ahead: next you define the Service Policy, Edge Router Policy, and Service Edge Router Policy, then verify traffic flows.',
  },
  policy: {
    lead: 'What does the Policy step do?',
    intro: [
      'Policies are how a service is authorized: they decide which identities may use it and which routers may carry it. Nothing reaches a service until the right policies line up — on the Advanced path you create them by hand here.',
      'You can add as many as you need, of three kinds. Each matches attributes on two sides, so a policy with an attribute on only one side (or neither) matches nothing and grants nothing.',
    ],
    keyPoints: [
      {
        icon: 'fa-solid fa-shield-halved',
        title: 'Service Policy — who may use the service',
        body: 'Grants identities the right to dial (access) or bind (host) the service. Its Type field picks which: Dial for clients, Bind for hosts.',
      },
      {
        icon: 'fa-solid fa-route',
        title: 'Router Policy — which routers identities may use',
        body: 'Grants identities the use of matching edge routers — their on-ramp to the overlay. Without it, an identity has no router to connect through.',
      },
      {
        icon: 'fa-solid fa-diagram-project',
        title: 'Service Edge Router Policy — which routers carry the service',
        body: 'Limits which edge routers may carry a given service. Situational — add it only when you need to steer a service onto particular routers.',
      },
    ],
    howItFits:
      'A working circuit usually needs at least a Service Policy (so identities may dial or bind the service) and a Router Policy (so those identities may use a router to reach it). Add both here, then verify traffic flows end-to-end. A Service Edge Router Policy is optional.',
  },
  'router-policy': {
    lead: 'What does a router policy do?',
    intro: [
      'A router policy (an edge router policy) decides which identities are allowed to use which edge routers. Identities connect to the overlay through a router, so until a policy grants an identity the right to use one, that identity has no on-ramp — it can be fully authorized for a service and still reach nothing.',
      'It works by matching attributes on two sides: edge router attributes on one side, identity attributes on the other. Every identity that matches is granted the use of every router that matches. That is why both sides are needed — a policy with an attribute on only one side (or neither) matches nothing and grants nothing.',
    ],
    keyPoints: [
      {
        icon: 'fa-solid fa-route',
        title: 'Grants use of routers',
        body: 'It authorizes identities to connect through the matching edge routers — the on-ramp to the overlay. Without it, an identity has no router to dial through.',
      },
      {
        icon: 'fa-solid fa-right-left',
        title: 'Distinct from service policies',
        body: 'Service policies (the dial and bind policies the Simple service already created for you) say WHAT an identity may reach. A router policy says HOW it gets there — which routers carry its traffic. Both must line up for a connection to work.',
      },
      {
        icon: 'fa-solid fa-hashtag',
        title: 'Both attribute sides are required',
        body: 'An edge router attribute picks the routers; an identity attribute picks the identities. A policy missing either side matches nothing — which is why onboarding requires both, even though the base form marks them optional.',
      },
    ],
    howItFits:
      'This is the last piece of authorization in the Simple path. The service exists and its dial and bind policies were created for you; the router policy now lets your identity actually use a router to reach it. With services and routers both authorized, the final step is to verify that traffic flows end-to-end.',
  },
  verify: {
    lead: 'What does verifying prove?',
    intro: [
      'Everything you configured — identity, router, service, and policies — describes what should happen. Verification is where you confirm it actually does: that a real request from your client is intercepted, tunneled across the network, and delivered out through the remote router, with nothing crossing the open internet.',
      'This is the one step the console cannot do for you. The traffic originates on your machine, so you prove it from where it lives — the desktop tunneler app that carries your identity, and a browser that shows where your traffic appears to come from.',
    ],
    keyPoints: [
      {
        icon: 'fa-solid fa-arrow-right-arrow-left',
        title: 'The IP change is the tell',
        body: 'With the identity enabled, a site like eth0.me reports the remote router’s public IP instead of your own — meaning your request left the network at the router, not your home connection.',
      },
      {
        icon: 'fa-solid fa-rotate-left',
        title: 'The revert is the proof',
        body: 'Disable the identity and the same site reverts to your local IP. The change-then-revert pair is what actually proves the tunnel caused it — a one-way check could be a coincidence; the revert rules that out.',
      },
      {
        icon: 'fa-solid fa-laptop',
        title: 'It happens outside the console',
        body: 'There is nothing to enter here. You confirm each step yourself in the tunneler app and the browser, then tick it off — an honest checklist, not a simulated result.',
      },
    ],
    howItFits:
      'Verification is the payoff and the finish line. Once your public IP shifts to the remote router when the identity is on and snaps back when it is off, you have observed the full path working end-to-end. That completes setup: the focused guide steps aside and the normal console takes over, where you manage the identities, services, routers, and policies you just created.',
  },
};
