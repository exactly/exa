# google cloud web frontend hosting

<!-- cspell:ignore anycast sepolia -->

## recommendation

use one shared global external application load balancer for all four stacks, not one load balancer per stack. keep a
small static frontend cloud run service and the api cloud run service for each stack, but put one google-managed edge
in front of all of them:

```mermaid
flowchart lr
  client[client] --> edge[one global anycast ip]
  edge --> routes[one certificate map and url map]
  routes --> production[web.exactly.app]
  routes --> base[base.exactly.app]
  routes --> sandbox[sandbox.exactly.app]
  routes --> sepolia[base-sepolia.exactly.app]
  production --> productionWeb[production frontend]
  production --> productionApi[production api]
  base --> baseWeb[base frontend]
  base --> baseApi[base api]
  sandbox --> sandboxWeb[sandbox frontend]
  sandbox --> sandboxApi[sandbox api]
  sepolia --> sepoliaWeb[base-sepolia frontend]
  sepolia --> sepoliaApi[base-sepolia api]
```

the url map selects a stack by hostname. inside each stack's path matcher, exact `/api` and `/api/**` requests go
directly to that stack's api backend with `/api` removed, while every other request goes to that stack's frontend
backend. google documents both multi-host url maps and prefix rewrites.
[url map host and path routing](https://docs.cloud.google.com/load-balancing/docs/url-map-concepts),
[global url rewrites](https://docs.cloud.google.com/load-balancing/docs/https/setting-up-global-traffic-mgmt#rewrite_the_requested_url)

this does not put a cloud run gateway in front of the api. an api request follows `browser -> google edge -> api cloud
run service`; it does not visit the frontend service. the load balancer preserves the public hostname and cookies, and
the url map adapts the public `/api` contract to the api's root mount. the frontend service is used only for static
routes and can keep the current expo route behavior and association responses without a bucket transform.

cloudflare is not the recommendation. proxying the api through a third-party worker would add a cross-cloud hop and a
second origin-authentication boundary to every api call merely to save a small fixed edge charge.

## the actual fixed cost

the forwarding-rule charge is not per load balancer. google prices the first five global forwarding rules in a project
together at `$0.025` per hour. one, three, or five rules in the same project all cost `$0.025` per hour. global and
regional rules are tiered separately, and the tier starts again in each project.
[cloud load balancing pricing](https://cloud.google.com/load-balancing/pricing#lb),
[forwarding-rule examples](https://cloud.google.com/load-balancing/pricing#forwarding-rules-pricing-examples)

the repository has four pulumi stacks but only two google cloud projects:

| project | stacks | domains |
| --- | --- | --- |
| `eexxxaa` | `production`, `base` | `web.exactly.app`, `base.exactly.app` |
| `exa-dev` | `sandbox`, `base-sepolia` | `sandbox.exactly.app`, `base-sepolia.exactly.app` |

the project mapping comes from the four [pulumi stack configurations](../infra/), while production's domain override
comes from [its workflow](../.github/workflows/server-production.yaml); the other domains follow the stack-name default
in [the pulumi program](../infra/index.ts).

if every stack had its own load balancer with one https rule and one http-to-https redirect rule, the repository would
create four global forwarding rules in each project. both projects remain inside their first-five tier:

| layout | global rules by project | approximate fixed monthly charge at 730 hours |
| --- | --- | --- |
| four separate load balancers in the current two projects | `eexxxaa: 4`, `exa-dev: 4` | `$36.50` total |
| one load balancer per current project | `eexxxaa: 2`, `exa-dev: 2` | `$36.50` total |
| one shared cross-project load balancer | one frontend project: `2` | `$18.25` total |

consolidating two load balancers into one inside the same project simplifies the resource graph but does not lower the
first-five forwarding-rule charge. consolidating the frontend into one project does lower it from two project tiers to
one. these estimates assume no unrelated global forwarding rules consume the tier and exclude traffic processing and
internet data transfer.

there is no separate charge for a static or ephemeral external ip address while it is attached to a forwarding rule.
certificate manager's first 100 certificates per project are free, so four managed certificates, or one wildcard
certificate where appropriate, add no fixed certificate charge.
[external ip pricing](https://cloud.google.com/vpc/pricing#ipaddress),
[certificate manager pricing](https://cloud.google.com/certificate-manager/pricing)

## why one load balancer can span both projects

`exa-dev` and `eexxxaa` are currently under the same google cloud organization. that makes google's cross-project
service referencing applicable. for a global external application load balancer:

- the global ip, forwarding rules, target proxies, certificate map, and url map live in one frontend project;
- the url map can reference backend services from other projects in the same organization;
- shared vpc is not required;
- cross-project service referencing supports serverless network endpoint groups, including cloud run;
- the deployment principal that updates the url map needs `compute.backendServices.use`, normally through
  `roles/compute.loadBalancerServiceUser`, on the referenced backend services or their projects.

[cross-project global load balancer setup](https://docs.cloud.google.com/load-balancing/docs/https/set-up-global-ext-https-shared-vpc#xpn_cross_project_service_referencing),
[cross-project usage notes](https://docs.cloud.google.com/load-balancing/docs/https#shared-vpc),
[cross-project iam](https://docs.cloud.google.com/load-balancing/docs/https/set-up-global-ext-https-shared-vpc#grant_permissions_to_the_compute_load_balancer_admin_to_use_the_backend_service)

the important boundary is that each backend service, its serverless network endpoint group, and its backing cloud run
service must stay together in the same project. therefore the shared edge does not merge the stacks' compute, secrets,
networks, identities, or application releases. only the hostname and path routing is shared.
[serverless neg cross-project requirements](https://docs.cloud.google.com/load-balancing/docs/negs/serverless-neg-concepts#limitations_with_backend_services)

load-balancer charges, including forwarding rules and processed data, are attributed to the project containing the
forwarding rule. the backend projects continue to pay their own cloud run compute charges.
[cross-project billing](https://cloud.google.com/load-balancing/pricing#shared-vpc-service-referencing)

## resource ownership

the pulumi ownership should follow resource lifetime:

1. each existing application stack owns its cloud run frontend and api services, both serverless network endpoint
   groups, and both backend services in its current google cloud project;
2. a separate shared edge component owns the global ip, certificate map, https proxy, url map, https forwarding rule,
   and the optional http redirect rule;
3. the edge refers to backend services by their fully qualified urls, which pulumi's url map resource accepts as
   service targets;
4. ordinary application releases update cloud run revisions without changing the shared edge;
5. removing a stack requires detaching its host rule before destroying its backend service.

[pulumi url map](https://www.pulumi.com/registry/packages/gcp/api-docs/compute/urlmap/),
[pulumi backend service](https://www.pulumi.com/registry/packages/gcp/api-docs/compute/backendservice/),
[pulumi certificate map entry](https://www.pulumi.com/registry/packages/gcp/api-docs/certificatemanager/certificatemapentry/)

do not let one of the four application stacks own the shared frontend. a production or sandbox deployment should not
be able to replace or delete routing for the other three stacks. the existing special `meta` program already knows all
stack-to-project mappings, but whether to extend it or introduce a distinct edge program is an implementation decision;
the shared resources need one state owner either way.

## cloud run access

after the load balancer is verified, set both frontend and api services to `internal and cloud load balancing` ingress.
this blocks direct internet access through their `run.app` urls while accepting load-balancer traffic. google's
documented serverless-neg setup still uses unauthenticated invocation at the cloud run iam layer, so the existing
`allUsers` invoker grant can remain; ingress is what forces public traffic through the edge.
[cloud run behind a global load balancer](https://docs.cloud.google.com/load-balancing/docs/https/setup-global-ext-https-serverless),
[cloud run ingress](https://docs.cloud.google.com/run/docs/securing/ingress)

the frontend and api need separate backend services. enable cloud cdn only for the frontend backend; never enable it on
the api backend. the api remains a direct managed load-balancer-to-cloud-run path, with no user-maintained proxy process
and no duplicate cloud run request.

## tradeoff and fallback

one global edge creates a shared routing and tls blast radius: a bad url-map or certificate-map update can affect all
four stacks. url-map tests should cover every hostname and both `/api` route shapes before pulumi accepts an update.
pulumi exposes url-map tests, and google validates them during an update.
[pulumi url map tests](https://www.pulumi.com/registry/packages/gcp/api-docs/compute/urlmap/#urlmaptest)

if production and non-production must have completely independent edge control planes, use one load balancer per
current google cloud project. that costs about `$36.50` monthly in fixed forwarding-rule charges, not almost `$100`,
and keeps mainnet stacks in `eexxxaa` separate from test stacks in `exa-dev`.

the cost-optimal gcp-only answer is nevertheless one cross-project global load balancer at about `$18.25` monthly plus
traffic. it keeps cookies and `/api`, avoids the extra api gateway hop, stays on google's network, and preserves all
four stacks' backend isolation.
