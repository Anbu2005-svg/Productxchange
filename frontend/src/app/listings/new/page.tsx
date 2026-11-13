"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  uploadProductImage,
  uploadProductImageWithAngle,
  convertProductTo3D,
  suggestListingAI,
  compressImage,
  getToken,
} from "@/lib/api";
import MultiAnglePhotoStudio, {
  AngleData,
  AnglePreviews,
} from "@/components/MultiAnglePhotoStudio";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { TypeTag } from "@/components/ui/Badge";
import {
  Camera,
  Layers,
  ArrowRight,
  ArrowLeft,
  Check,
  Upload,
  X,
  Sparkles,
  MapPin,
  CheckCircle2,
  AlertCircle,
  FileText,
  Tag,
} from "lucide-react";

const TRANSACTION_TYPES = ["BUY", "EXCHANGE", "RENT", "DONATE"] as const;
const CATEGORIES = [
  "Textbooks & Study Material",
  "Electronics & Gadgets",
  "Lab Equipment & Calculators",
  "Cycles & Mobility",
  "Hostel & Room Essentials",
  "Sports & Fitness",
  "Other",
];
const CONDITIONS = ["Brand New", "Like New", "Good", "Fair"];

const STEPS = [
  { id: 1, label: "Photos" },
  { id: 2, label: "Details" },
  { id: 3, label: "Price & type" },
  { id: 4, label: "Location" },
  { id: 5, label: "Review" },
];

const DRAFT_KEY = "px_new_listing_draft_v2";

export default function NewListingPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [createdProduct, setCreatedProduct] = useState<{ id: number; title: string } | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login?redirect=/listings/new");
    }
  }, [router]);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Textbooks & Study Material",
    condition: "Good",
    price: "",
    transaction_type: "BUY",
    pickup_area: "",
  });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // 3D Multi-Angle Studio state
  const [use3DStudio, setUse3DStudio] = useState(true);
  const [angleFiles, setAngleFiles] = useState<AngleData>({});
  const [anglePreviews, setAnglePreviews] = useState<AnglePreviews>({});
  const [is3DReady, setIs3DReady] = useState(false);

  // Restore draft from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.form) {
          setForm((prev) => ({ ...prev, ...parsed.form }));
        }
      }
    } catch {}
  }, []);

  // Autosave draft on form changes
  useEffect(() => {
    try {
      const timer = setTimeout(() => {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form }));
        const now = new Date();
        setLastSaved(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      }, 600);
      return () => clearTimeout(timer);
    } catch {}
  }, [form]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (selectedFiles.length + files.length > 6) {
      setError("Maximum 6 additional photos allowed.");
      return;
    }

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setError("Each photo must be smaller than 5MB.");
        return;
      }
    }

    const newFiles = [...selectedFiles, ...files];
    const newPreviews = [...previewUrls, ...files.map((f) => URL.createObjectURL(f))];

    setSelectedFiles(newFiles);
    setPreviewUrls(newPreviews);
    setError(null);
  }

  function handleRemoveFile(index: number) {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    const updatedPreviews = previewUrls.filter((_, i) => i !== index);
    setSelectedFiles(updatedFiles);
    setPreviewUrls(updatedPreviews);
  }

  function handleSetAsCover(index: number) {
    if (index === 0) return;
    const files = [...selectedFiles];
    const previews = [...previewUrls];

    const [movedFile] = files.splice(index, 1);
    const [movedPreview] = previews.splice(index, 1);

    files.unshift(movedFile);
    previews.unshift(movedPreview);

    setSelectedFiles(files);
    setPreviewUrls(previews);
  }

  async function handleAiAnalyze() {
    const targetPhoto = angleFiles.front || selectedFiles[0];
    if (!targetPhoto) {
      setError("Please choose or upload a product photo first to use assisted fill.");
      return;
    }

    setAnalyzingAI(true);
    setAiNotice(null);
    setError(null);

    try {
      const res = await suggestListingAI(targetPhoto);
      if (res.title || res.description || res.suggested_price) {
        setForm((prev) => ({
          ...prev,
          title: res.title || prev.title,
          description: res.description || prev.description,
          price: res.suggested_price != null ? String(res.suggested_price) : prev.price,
          category: res.attributes?.category || prev.category,
          condition: res.attributes?.condition ? capitalize(res.attributes.condition) : prev.condition,
        }));
        setAiNotice("Suggested title, description and category generated from your photo. You can edit them in the next steps.");
      } else {
        setAiNotice("No automatic suggestions found. Please fill in the details manually.");
      }
    } catch (e: any) {
      setError(e.message || "Failed to analyze image.");
    } finally {
      setAnalyzingAI(false);
    }
  }

  function capitalize(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  function validateStep(targetStep: number): boolean {
    setError(null);
    if (targetStep === 1) {
      const hasAnyPhoto = Boolean(anglePreviews.front || selectedFiles.length > 0);
      if (!hasAnyPhoto) {
        setError("Please upload at least one photo (front view or cover photo) before proceeding.");
        return false;
      }
    }
    if (targetStep === 2) {
      if (!form.title.trim()) {
        setError("Please enter a title for your item.");
        return false;
      }
      if (form.description && form.description.length > 2000) {
        setError("Description must be under 2000 characters.");
        return false;
      }
    }
    if (targetStep === 3) {
      if (form.transaction_type === "BUY" && (!form.price || Number(form.price) <= 0)) {
        setError("Please enter a price for items you wish to sell.");
        return false;
      }
      if (form.price) {
        const p = Number(form.price);
        if (isNaN(p) || p < 0) {
          setError("Price must be a valid positive number.");
          return false;
        }
        if (p > 1000000) {
          setError("Price cannot exceed ₹10,00,000.");
          return false;
        }
      }
    }
    return true;
  }

  function handleNext() {
    if (validateStep(step)) {
      setStep((s) => Math.min(s + 1, 5));
    }
  }

  function handleBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  async function createWithCoords(lat: number, lng: number) {
    const product = await api("/products", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        price: form.price ? Number(form.price) : null,
        latitude: lat,
        longitude: lng,
        has_3d: is3DReady,
      }),
    });

    if (product.id) {
      // 1. Upload 3D angle images
      const angleEntries = Object.entries(angleFiles).filter(([_, f]) => Boolean(f)) as [string, File][];
      if (angleEntries.length > 0) {
        for (const [angle, file] of angleEntries) {
          try {
            const compressed = await compressImage(file);
            await uploadProductImageWithAngle(product.id, compressed, angle);
          } catch {}
        }
        if (is3DReady) {
          try {
            await convertProductTo3D(product.id);
          } catch {}
        }
      }

      // 2. Upload any additional standard photos
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          try {
            const compressed = await compressImage(file);
            await uploadProductImage(product.id, compressed);
          } catch {}
        }
      }
    }

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}

    setCreatedProduct({ id: product.id, title: product.title || form.title });
    showToast("Listing created successfully", "success");
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
      return;
    }

    setSubmitting(true);
    setError(null);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await createWithCoords(pos.coords.latitude, pos.coords.longitude);
          } catch (err: any) {
            setError(err.message || "Failed to create listing");
            setSubmitting(false);
          }
        },
        async () => {
          try {
            await createWithCoords(12.9716, 77.5946);
          } catch (err: any) {
            setError(err.message || "Failed to create listing");
            setSubmitting(false);
          }
        }
      );
    } else {
      try {
        await createWithCoords(12.9716, 77.5946);
      } catch (err: any) {
        setError(err.message || "Failed to create listing");
        setSubmitting(false);
      }
    }
  }

  // Success view
  if (createdProduct) {
    return (
      <div className="mx-auto max-w-xl py-12">
        <div className="rounded-lg border border-border bg-surface p-6 text-center sm:p-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle text-success">
            <CheckCircle2 className="h-6 w-6" strokeWidth={2} />
          </div>
          <h1 className="text-xl font-semibold text-text">Listing published</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Your item <span className="font-medium text-text">{createdProduct.title}</span> is now live in the campus feed.
          </p>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Link href={`/listings/${createdProduct.id}`}>
              <Button variant="primary">View listing</Button>
            </Link>
            <Link href="/">
              <Button variant="secondary">Browse campus feed</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-4 sm:py-6">
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">List an item</h1>
          <p className="text-xs text-text-secondary">
            Share books, electronics, or campus gear with verified peers
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="hidden text-xs text-text-tertiary sm:inline">
              Draft saved {lastSaved}
            </span>
          )}
          <Link href="/" className="text-xs font-medium text-text-secondary hover:text-text">
            Cancel
          </Link>
        </div>
      </div>

      {/* 5-Step Stepper Header */}
      <nav aria-label="Progress" className="mb-6">
        <ol className="flex items-center justify-between border-b border-border pb-3">
          {STEPS.map((s) => {
            const isActive = s.id === step;
            const isDone = s.id < step;
            return (
              <li key={s.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (s.id < step || validateStep(step)) {
                      setStep(s.id);
                    }
                  }}
                  className={`flex items-center gap-2 text-xs font-medium transition-colors ${
                    isActive
                      ? "text-primary"
                      : isDone
                      ? "text-text hover:text-primary"
                      : "text-text-tertiary"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                      isActive
                        ? "bg-primary text-on-primary"
                        : isDone
                        ? "bg-primary-subtle text-primary"
                        : "border border-border bg-surface-muted text-text-tertiary"
                    }`}
                  >
                    {isDone ? <Check className="h-3 w-3" strokeWidth={2.5} /> : s.id}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Main Stepped Form Container */}
      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        {error && (
          <div className="mb-5 flex items-start gap-2.5 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
            <div className="flex-1">{error}</div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-danger hover:opacity-70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* STEP 1: PHOTOS */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-text">Photos and 3D capture</h2>
                  <p className="text-xs text-text-secondary">
                    Clear photos help your listing sell faster and build trust
                  </p>
                </div>

                <div className="flex items-center rounded-md border border-border bg-surface-muted p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setUse3DStudio(true)}
                    className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                      use3DStudio
                        ? "bg-surface text-text shadow-xs"
                        : "text-text-secondary hover:text-text"
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" strokeWidth={1.75} /> 3D studio
                  </button>
                  <button
                    type="button"
                    onClick={() => setUse3DStudio(false)}
                    className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                      !use3DStudio
                        ? "bg-surface text-text shadow-xs"
                        : "text-text-secondary hover:text-text"
                    }`}
                  >
                    <Camera className="h-3.5 w-3.5" strokeWidth={1.75} /> Standard photos
                  </button>
                </div>
              </div>
            </div>

            {use3DStudio ? (
              <div className="space-y-4">
                <MultiAnglePhotoStudio
                  initialPreviews={anglePreviews}
                  onAnglesChange={(files, previews, ready) => {
                    setAngleFiles(files);
                    setAnglePreviews(previews);
                    setIs3DReady(ready);
                  }}
                  onError={(err) => setError(err)}
                />

                {anglePreviews.front && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleAiAnalyze}
                      disabled={analyzingAI}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
                      <span>{analyzingAI ? "Analyzing photo..." : "Autofill details from photo"}</span>
                    </Button>
                    <span className="text-xs text-text-tertiary">
                      Uses front view to suggest title and category
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {previewUrls.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {previewUrls.map((url, idx) => (
                      <div
                        key={idx}
                        className="group relative aspect-4/3 overflow-hidden rounded-md border border-border bg-surface-muted"
                      >
                        <img src={url} alt={`Upload ${idx + 1}`} className="h-full w-full object-cover" />
                        {idx === 0 && (
                          <span className="absolute left-2 top-2 rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-text shadow-xs">
                            Cover
                          </span>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          {idx !== 0 && (
                            <button
                              type="button"
                              onClick={() => handleSetAsCover(idx)}
                              className="rounded-md bg-surface px-2 py-1 text-xs font-medium text-text shadow-xs hover:bg-surface-muted"
                            >
                              Set cover
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(idx)}
                            className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-on-primary shadow-xs hover:opacity-90"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedFiles.length < 6 && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-surface-muted"
                  >
                    <Upload className="mb-2 h-6 w-6 text-text-tertiary" strokeWidth={1.75} />
                    <p className="text-xs font-medium text-text">
                      {selectedFiles.length === 0 ? "Click to upload photos" : "Add more photos"}
                    </p>
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      PNG, JPG, WEBP up to 5MB (maximum 6 photos)
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </div>
                )}

                {selectedFiles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleAiAnalyze}
                      disabled={analyzingAI}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
                      <span>{analyzingAI ? "Analyzing photo..." : "Autofill details from cover"}</span>
                    </Button>
                    <span className="text-xs text-text-tertiary">
                      Uses cover photo to suggest title and category
                    </span>
                  </div>
                )}
              </div>
            )}

            {aiNotice && (
              <div className="rounded-md border border-primary/20 bg-primary-subtle p-3 text-xs text-primary">
                {aiNotice}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: DETAILS */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-text">Item details</h2>
              <p className="text-xs text-text-secondary">
                Describe the item accurately to help students search
              </p>
            </div>

            <div>
              <Input
                label="Item title"
                required
                placeholder="e.g. Engineering Mathematics 3rd Ed. (Erwin Kreyszig)"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                helperText="Include edition, author, or model number if applicable"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text">
                  Category <span className="text-danger">*</span>
                </label>
                <Select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-text">
                  Condition <span className="text-danger">*</span>
                </label>
                <Select
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value })}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-text">
                Description
              </label>
              <textarea
                rows={4}
                placeholder="Note any highlights, minor scratches, included cables, or textbook condition..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-md border border-border bg-surface p-3 text-sm text-text placeholder:text-text-tertiary focus:border-primary focus:outline-hidden"
              />
              <p className="mt-1 text-xs text-text-tertiary">
                {form.description.length} / 2000 characters
              </p>
            </div>
          </div>
        )}

        {/* STEP 3: PRICE & TYPE */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-text">Price and transaction type</h2>
              <p className="text-xs text-text-secondary">
                Select how you want to transact on campus
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-text">
                Transaction type
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TRANSACTION_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm({ ...form, transaction_type: type })}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      form.transaction_type === type
                        ? "border-primary bg-primary-subtle text-primary font-medium"
                        : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text"
                    }`}
                  >
                    <div className="text-xs font-semibold">{type}</div>
                    <div className="mt-1 text-[11px] text-text-tertiary">
                      {type === "BUY" && "Standard one-time sale"}
                      {type === "RENT" && "Lend for a period"}
                      {type === "EXCHANGE" && "Trade for other gear"}
                      {type === "DONATE" && "Give away for free"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {form.transaction_type !== "DONATE" && (
              <div>
                <Input
                  label={form.transaction_type === "RENT" ? "Rental price (₹)" : "Price (₹)"}
                  type="number"
                  required={form.transaction_type === "BUY"}
                  placeholder="e.g. 450"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  helperText={
                    form.price
                      ? `Formatted: ₹${new Intl.NumberFormat("en-IN").format(Number(form.price) || 0)}`
                      : "Zero platform fees. You receive 100% of the agreed amount."
                  }
                />
              </div>
            )}

            {form.transaction_type === "DONATE" && (
              <div className="rounded-md border border-border bg-surface-muted p-4 text-xs text-text-secondary">
                Donations are free of cost for fellow students. The price is automatically set to ₹0.
              </div>
            )}
          </div>
        )}

        {/* STEP 4: LOCATION */}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-text">Campus meetup location</h2>
              <p className="text-xs text-text-secondary">
                Designate a recognizable campus landmark for handover
              </p>
            </div>

            <div>
              <Input
                label="Pickup instructions or area"
                placeholder="e.g. Near Central Library entrance or Boys Hostel 4 lobby"
                value={form.pickup_area}
                onChange={(e) => setForm({ ...form, pickup_area: e.target.value })}
                helperText="Location details are kept private and revealed only after an offer is confirmed."
              />
            </div>

            <div className="rounded-md border border-border bg-surface-muted p-4 text-xs leading-relaxed text-text-secondary">
              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 shrink-0 text-primary mt-0.5" strokeWidth={1.75} />
                <div>
                  <p className="font-medium text-text">Campus privacy protection</p>
                  <p className="mt-0.5">
                    Your exact coordinates are never shown on the public map. The feed displays only your approximate distance to protect student safety.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: REVIEW */}
        {step === 5 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-text">Review and publish</h2>
              <p className="text-xs text-text-secondary">
                Confirm your listing details before publishing to campus
              </p>
            </div>

            <div className="rounded-md border border-border bg-surface-muted p-4 text-xs space-y-3">
              <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
                <div>
                  <div className="text-xs text-text-tertiary">Item</div>
                  <div className="text-sm font-semibold text-text mt-0.5">{form.title}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-tertiary">Price</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-text mt-0.5">
                    {form.transaction_type === "DONATE"
                      ? "Free"
                      : form.price
                      ? `₹${new Intl.NumberFormat("en-IN").format(Number(form.price))}`
                      : "Negotiable"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <span className="text-text-tertiary">Type:</span>
                  <div className="mt-0.5">
                    <TypeTag type={form.transaction_type} />
                  </div>
                </div>
                <div>
                  <span className="text-text-tertiary">Category:</span>
                  <div className="mt-0.5 font-medium text-text truncate">{form.category}</div>
                </div>
                <div>
                  <span className="text-text-tertiary">Condition:</span>
                  <div className="mt-0.5 font-medium text-text">{form.condition}</div>
                </div>
                <div>
                  <span className="text-text-tertiary">3D model:</span>
                  <div className="mt-0.5 font-medium text-text">
                    {is3DReady ? "Ready" : "Not configured"}
                  </div>
                </div>
              </div>

              {form.description && (
                <div className="border-t border-border pt-3">
                  <span className="text-text-tertiary">Description:</span>
                  <p className="mt-0.5 text-text leading-relaxed whitespace-pre-wrap">
                    {form.description}
                  </p>
                </div>
              )}

              {form.pickup_area && (
                <div className="border-t border-border pt-3">
                  <span className="text-text-tertiary">Pickup note:</span>
                  <p className="mt-0.5 text-text">{form.pickup_area}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation Actions */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <div>
            {step > 1 && (
              <Button type="button" variant="secondary" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                <span>Back</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step < 5 ? (
              <Button type="button" variant="primary" onClick={handleNext}>
                <span>Continue</span>
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={() => handleSubmit()}
                disabled={submitting}
              >
                <span>{submitting ? "Publishing listing..." : "Publish listing"}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
