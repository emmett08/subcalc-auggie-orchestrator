# Functional Requirements Document (FRD)
## Subnet Calculator (IPv4 / IPv6)

**Document ID:** FRD-SUBCALC-001  
**Version:** 1.0  
**Status:** Baseline  
**Audience:** Network Engineers, Platform/SRE Teams, Developers, Educators  
**Methodology:** Hermeneutic Circle (iterative whole–part–whole refinement)

---

## 1. Purpose

The purpose of this document is to define the complete functional requirements for a **Subnet Calculator** capable of supporting IPv4 and IPv6 address planning, validation, visualisation, and automation workflows.  

The system is intended not merely as a CIDR arithmetic tool, but as a **network design, reasoning, and verification system** usable by humans and automation.

---

## 2. Scope

### In scope
- IPv4 and IPv6 subnet calculation
- CIDR, netmask, and range conversions
- Subnet splitting, merging, and summarisation
- VLSM planning and allocation
- Overlap and containment validation
- Visual binary-tree-based design surface
- Import/export and automation hooks
- Traceability, documentation, and audit support

### Out of scope
- Live IPAM integration (can be added later)
- Real-time network discovery
- Packet-level simulation

---

## 3. Users & Personas

| Persona | Description |
|-------|-------------|
| Network Engineer | Designs address plans, validates routing and summarisation |
| SRE / Platform Engineer | Integrates CIDRs into IaC, Kubernetes, cloud networks |
| Security Engineer | Reviews segmentation boundaries and policies |
| Educator / Student | Learns subnetting and IPv6 concepts |
| Automation Agent | Consumes API/CLI outputs in CI pipelines |

---

## 4. Definitions

- **Prefix:** CIDR block (e.g. `10.0.0.0/16`, `2001:db8::/48`)
- **Subnet:** A derived prefix from a parent prefix
- **VLSM:** Variable Length Subnet Masking
- **Summarisation:** Aggregation of contiguous prefixes
- **Containment:** Address or prefix inclusion
- **Overlap:** Partial or full intersection of address space

---

## 5. Functional Requirements

### 5.1 Input & Normalisation

**FR-001** Accept IPv4 input in dotted-decimal with CIDR or netmask  
**FR-002** Accept IPv6 input in compressed or full notation with CIDR  
**FR-003** Accept IP ranges and convert to minimal covering prefixes  
**FR-004** Canonicalise all inputs internally  
**FR-005** Validate inputs with precise error messages  
**FR-006** Classify special ranges (private, loopback, multicast, documentation)

---

### 5.2 Core Calculations

**FR-010** Compute IPv4 network, broadcast, usable range, counts  
**FR-011** Compute IPv6 network range and address space size  
**FR-012** Compute reverse-DNS boundaries  
**FR-013** Provide binary and bit-boundary visualisations  

---

### 5.3 Transformations

**FR-020** Binary split of a prefix  
**FR-021** Split into N equal subnets  
**FR-022** Split by required host count  
**FR-023** Merge sibling prefixes  
**FR-024** Summarise a set of prefixes  
**FR-025** Compute minimal covering supernet  

---

### 5.4 Set Reasoning & Validation

**FR-030** Check IP containment  
**FR-031** Check prefix containment  
**FR-032** Detect overlaps  
**FR-033** Detect adjacency and merge eligibility  
**FR-034** Compute union / intersection / difference  

---

### 5.5 VLSM Planning

**FR-040** Allocate VLSM subnets under a parent  
**FR-041** Support allocation strategies (largest-first, balanced, etc.)  
**FR-042** Support reserved/unallocatable blocks  
**FR-043** Attach metadata to subnets  
**FR-044** Track allocation state  
**FR-045** Enforce allocation policies and constraints  

---

### 5.6 Visual Designer

**FR-050** Visualise subnet hierarchy as a binary tree  
**FR-051** Ensure leaf nodes never overlap visually  
**FR-052** Support node selection with sticky focus  
**FR-053** Display floating property panel for selected node  
**FR-054** Support pan, zoom, fit-to-view  
**FR-055** Fully themeable UI (light/dark)  
**FR-056** Collapse/expand subtrees  
**FR-057** Visual cues for invalid, reserved, or deprecated subnets  

---

### 5.7 Search & Query

**FR-060** Search subnets by metadata  
**FR-061** Longest-prefix-match lookup for IPs  
**FR-062** Navigate parent/child lineage  
**FR-063** Filter by IP version, size, status  

---

### 5.8 Import / Export & Automation

**FR-070** Export subnet data (JSON, CSV, Markdown)  
**FR-071** Export full design model  
**FR-072** Import designs with validation  
**FR-073** Export IaC-friendly artefacts  
**FR-074** Provide programmatic API  
**FR-075** Provide CLI interface  

---

### 5.9 Traceability & Audit

**FR-080** Track design changes  
**FR-081** Diff designs  
**FR-082** Support notes and references  
**FR-083** Export read-only reports (PDF/PNG/SVG)  

---

### 5.10 Safety & Guidance

**FR-090** Prevent invalid prefixes  
**FR-091** Offer corrective normalisation  
**FR-092** Warn on edge cases (/31, /32, /127)  
**FR-093** Support policy constraints  

---

## 6. Use Cases (Summary)

- **UC-001–004:** Single prefix calculation and explanation  
- **UC-010–015:** Splitting, merging, summarisation  
- **UC-020–024:** Validation and set reasoning  
- **UC-030–035:** VLSM planning and capacity analysis  
- **UC-040–047:** Visual design and interaction  
- **UC-050–053:** Search and reverse lookup  
- **UC-060–065:** Import/export and automation  
- **UC-070–073:** Audit, diff, and publishing  

(Full UC detail can be expanded in a companion UCD document.)

---

## 7. Acceptance Criteria

- All calculations are correct and deterministic  
- No visual overlap of leaf nodes  
- All requirements mapped to tests and code  
- All automated checks pass  
- Light and dark themes verified  

---

## 8. Traceability

Each requirement (FR-xxx) and use case (UC-xxx) MUST be traceable to:
- Source files
- Automated tests
- Storybook stories (UI-related)

---

## 9. Future Extensions (Non-binding)

- IPAM integration
- Policy-as-code engines
- Multi-user collaboration
- Constraint solvers for large-scale allocation

---

**End of Document**