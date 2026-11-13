"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import Button from "@/components/ui/Button";
import {
  Leaf,
  Printer,
  X,
  BookOpen,
  Laptop,
  PenTool,
  Bike,
  Microscope,
  Home,
  Armchair,
  Package,
} from "lucide-react";

type SustainabilityData = {
  summary: {
    total_co2_saved_kg: number;
    trees_equivalent: number;
    total_waste_diverted_kg: number;
    total_rupees_saved: number;
    items_circulated: number;
    completed_deals: number;
  };
  category_distribution: { category: string; count: number }[];
  user_impact: {
    user_id: number;
    tier: string;
    co2_saved_kg: number;
    waste_diverted_kg: number;
    rupees_saved: number;
    items_shared: number;
    deals_completed: number;
  } | null;
};

const CATEGORY_ICONS: Record<string, any> = {
  Textbooks: BookOpen,
  Books: BookOpen,
  Electronics: Laptop,
  Stationery: PenTool,
  Cycles: Bike,
  "Lab Equipment": Microscope,
  "Hostel Essentials": Home,
  Furniture: Armchair,
};

export default function SustainabilityImpactPage() {
  const router = useRouter();
  const [data, setData] = useState<SustainabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCertificate, setShowCertificate] = useState(false);
  const [userName, setUserName] = useState("Campus Student");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login?redirect=/impact");
      return;
    }
    api("/auth/me")
      .then((u) => {
        if (u?.full_name) setUserName(u.full_name);
        else if (u?.email) setUserName(u.email.split("@")[0]);
      })
      .catch(() => {});

    api("/analytics/sustainability")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [router]);

  const maxCategoryCount = Math.max(
    ...(data?.category_distribution.map((c) => c.count) || [1]),
    1
  );

  return (
    <div className="mx-auto max-w-4xl py-4 sm:py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-xl font-semibold text-text">Eco-impact and circularity</h1>
          <p className="mt-0.5 text-xs text-text-secondary">
            Measurable campus resource conservation through peer-to-peer exchange
          </p>
        </div>

        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowCertificate(true)}
          >
            <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Eco certificate</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-xs text-text-secondary">
          Loading campus eco-metrics...
        </div>
      ) : data ? (
        <>
          {/* Three Primary Stat Tiles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Tile 1: CO2 offset */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="text-xs font-medium text-text-secondary">
                CO₂ offset
              </div>
              <div className="mt-2 flex items-baseline gap-1.5 font-mono text-3xl font-semibold tabular-nums text-text">
                {new Intl.NumberFormat("en-IN").format(
                  data.summary.total_co2_saved_kg
                )}
                <span className="font-sans text-xs font-normal text-text-tertiary">
                  kg
                </span>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">
                Equivalent to ~{data.summary.trees_equivalent} mature trees absorbing carbon for one year
              </p>
            </div>

            {/* Tile 2: Waste diverted */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="text-xs font-medium text-text-secondary">
                E-waste and paper prevented
              </div>
              <div className="mt-2 flex items-baseline gap-1.5 font-mono text-3xl font-semibold tabular-nums text-text">
                {new Intl.NumberFormat("en-IN").format(
                  data.summary.total_waste_diverted_kg
                )}
                <span className="font-sans text-xs font-normal text-text-tertiary">
                  kg
                </span>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">
                Physical academic goods diverted from regional landfills
              </p>
            </div>

            {/* Tile 3: Money saved */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="text-xs font-medium text-text-secondary">
                Student community saved
              </div>
              <div className="mt-2 flex items-baseline gap-1 font-mono text-3xl font-semibold tabular-nums text-text">
                ₹{new Intl.NumberFormat("en-IN").format(
                  data.summary.total_rupees_saved
                )}
              </div>
              <p className="mt-1 text-xs text-text-tertiary">
                Across {data.summary.completed_deals} completed handovers with zero platform fees
              </p>
            </div>
          </div>

          {/* Simple Single-Color Chart: Circularity by Category */}
          <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-text">
                  Circulated items by category
                </h2>
                <p className="text-xs text-text-secondary">
                  Distribution of secondary lifecycles across student essentials
                </p>
              </div>
              <span className="font-mono text-xs tabular-nums text-text-tertiary">
                {data.summary.items_circulated} total items
              </span>
            </div>

            <div className="space-y-3 pt-2">
              {data.category_distribution.map((cat) => {
                const IconComponent = CATEGORY_ICONS[cat.category] || Package;
                const percentage = Math.round((cat.count / maxCategoryCount) * 100);

                return (
                  <div key={cat.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <IconComponent className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={1.75} />
                        <span className="font-medium text-text">{cat.category}</span>
                      </div>
                      <span className="font-mono tabular-nums text-text-secondary font-medium">
                        {cat.count}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted border border-border">
                      <div
                        style={{ width: `${percentage}%` }}
                        className="h-full bg-primary transition-all duration-300"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Personal Eco Summary (if user impact data exists) */}
          {data.user_impact && (
            <div className="rounded-lg border border-border bg-surface-muted p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text">
                      Your contribution
                    </span>
                    <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">
                      {data.user_impact.tier}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Based on your listings shared and physical handshakes completed
                  </p>
                </div>

                <div className="flex items-center gap-6 text-xs">
                  <div>
                    <div className="font-mono text-base font-semibold tabular-nums text-text">
                      {data.user_impact.co2_saved_kg} kg
                    </div>
                    <div className="text-[11px] text-text-tertiary">CO₂ prevented</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-semibold tabular-nums text-text">
                      ₹{new Intl.NumberFormat("en-IN").format(data.user_impact.rupees_saved)}
                    </div>
                    <div className="text-[11px] text-text-tertiary">Money saved</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-semibold tabular-nums text-text">
                      {data.user_impact.items_shared}
                    </div>
                    <div className="text-[11px] text-text-tertiary">Items shared</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Printable Certificate Modal */}
      {showCertificate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-xl rounded-lg border border-border bg-surface p-6 shadow-lg sm:p-8 space-y-6">
            <button
              onClick={() => setShowCertificate(false)}
              className="absolute right-4 top-4 text-text-tertiary hover:text-text"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Printable Certificate Card */}
            <div className="printable-area rounded-md border border-border bg-surface p-6 text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                <Leaf className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <span>ProductXchange Campus Sustainability</span>
              </div>

              <div>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">
                  Certificate of Circular Contribution
                </div>
                <h3 className="mt-1 text-lg font-semibold text-text">
                  Campus Eco Partner
                </h3>
              </div>

              <p className="mx-auto max-w-md text-xs leading-relaxed text-text-secondary">
                This acknowledges that <span className="font-semibold text-text">{userName}</span> has actively participated in the university circular marketplace, extending the usable lifecycle of campus essentials.
              </p>

              <div className="grid grid-cols-3 gap-2 border-y border-border py-3 text-xs max-w-md mx-auto">
                <div>
                  <div className="font-mono text-base font-semibold tabular-nums text-text">
                    {data?.user_impact?.co2_saved_kg ?? data?.summary.total_co2_saved_kg ?? 12} kg
                  </div>
                  <div className="text-[10px] text-text-tertiary uppercase">CO₂ offset</div>
                </div>
                <div>
                  <div className="font-mono text-base font-semibold tabular-nums text-text">
                    {data?.summary.trees_equivalent ?? 4}
                  </div>
                  <div className="text-[10px] text-text-tertiary uppercase">Trees equivalent</div>
                </div>
                <div>
                  <div className="font-mono text-base font-semibold tabular-nums text-text">
                    {data?.user_impact?.waste_diverted_kg ?? data?.summary.total_waste_diverted_kg ?? 8} kg
                  </div>
                  <div className="text-[10px] text-text-tertiary uppercase">Waste diverted</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-text-tertiary pt-2">
                <span>Date: {new Date().toLocaleDateString("en-IN")}</span>
                <span>ID: PX-{Date.now().toString(36).toUpperCase()}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowCertificate(false)}
              >
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => window.print()}
              >
                <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Print receipt</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
