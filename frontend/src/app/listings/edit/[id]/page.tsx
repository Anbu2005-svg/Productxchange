"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  Product,
  resolveImageUrl,
  uploadProductImage,
  uploadProductImageWithAngle,
  convertProductTo3D,
} from "@/lib/api";
import MultiAnglePhotoStudio, {
  AngleData,
  AnglePreviews,
} from "@/components/MultiAnglePhotoStudio";
import CameraCaptureModal from "@/components/CameraCaptureModal";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import {
  ArrowLeft,
  Camera,
  Layers,
  Upload,
  X,
  AlertCircle,
  Save,
  Check,
} from "lucide-react";

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

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    condition: "Good",
    price: "",
    pickup_area: "",
  });

  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);

  // 3D Studio state
  const [activePhotoTab, setActivePhotoTab] = useState<"3d" | "classic">("3d");
  const [angleFiles, setAngleFiles] = useState<AngleData>({});
  const [anglePreviews, setAnglePreviews] = useState<AnglePreviews>({});
  const [is3DReady, setIs3DReady] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const user = await api("/auth/me").catch(() => null);
        if (!user) {
          router.push(`/login?redirect=/listings/edit/${id}`);
          return;
        }

        const product: Product = await api(`/products/${id}`);
        if (product.seller_id !== user.id) {
          setError("You do not have permission to edit this listing.");
          setLoading(false);
          return;
        }

        setForm({
          title: product.title || "",
          description: product.description || "",
          category: product.category || CATEGORIES[0],
          condition: product.condition || "Good",
          price: product.price ? String(product.price) : "",
          pickup_area: product.pickup_area || "",
        });
        setExistingImages(product.image_urls || []);

        if (product.image_angles) {
          try {
            const rawAngles =
              typeof product.image_angles === "string"
                ? JSON.parse(product.image_angles)
                : product.image_angles;
            const resolved: AnglePreviews = {};
            for (const [k, v] of Object.entries(rawAngles)) {
              if (v) resolved[k as keyof AnglePreviews] = resolveImageUrl(v as string);
            }
            setAnglePreviews(resolved);
            if (product.has_3d) {
              setIs3DReady(true);
            }
          } catch {}
        }
      } catch (e: any) {
        setError(e.message || "Failed to load listing.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, router]);

  function addNewFiles(files: File[]) {
    if (!files.length) return;

    if (existingImages.length + newFiles.length + files.length > 5) {
      setError("Maximum 5 photos allowed per listing.");
      return;
    }

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setError("Each photo must be under 5MB.");
        return;
      }
    }

    setNewFiles([...newFiles, ...files]);
    setNewPreviews([...newPreviews, ...files.map((f) => URL.createObjectURL(f))]);
    setError(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addNewFiles(Array.from(e.target.files || []));
    e.target.value = "";
  }

  function handleRemoveNewFile(index: number) {
    setNewFiles(newFiles.filter((_, i) => i !== index));
    setNewPreviews(newPreviews.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload: Record<string, any> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        condition: form.condition,
        pickup_area: form.pickup_area.trim() || null,
        has_3d: is3DReady,
      };

      if (form.price !== "") {
        payload.price = Number(form.price);
      }

      await api(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      const angleEntries = Object.entries(angleFiles).filter(([_, f]) => Boolean(f)) as [string, File][];
      if (angleEntries.length > 0) {
        setUploadingImage(true);
        for (const [angle, file] of angleEntries) {
          try {
            await uploadProductImageWithAngle(Number(id), file, angle);
          } catch {}
        }
        if (is3DReady) {
          try {
            await convertProductTo3D(Number(id));
          } catch {}
        }
      } else if (is3DReady) {
        try {
          await convertProductTo3D(Number(id));
        } catch {}
      }

      if (newFiles.length > 0) {
        setUploadingImage(true);
        for (const file of newFiles) {
          await uploadProductImage(Number(id), file);
        }
      }

      showToast("Listing updated successfully", "success");
      router.push(`/listings/${id}`);
    } catch (e: any) {
      setError(e.message || "Failed to update listing.");
      showToast(e.message || "Update failed", "error");
    } finally {
      setSubmitting(false);
      setUploadingImage(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center text-xs text-text-secondary">
        Loading listing details...
      </div>
    );
  }

  if (error && !form.title) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <p className="mb-3 text-sm font-medium text-danger">{error}</p>
        <Link href={`/listings/${id}`} className="text-xs text-primary hover:underline">
          Return to listing
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-4 sm:py-6">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href={`/listings/${id}`}
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Back to listing</span>
        </Link>
        <span className="font-mono text-xs tabular-nums text-text-tertiary">
          Listing #{id}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <h1 className="text-xl font-semibold text-text">Edit listing</h1>
        <p className="mt-1 text-xs text-text-secondary">
          Update price, condition, or upload revised photos
        </p>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <Input
              label="Item title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
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
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-text">
                Condition
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
            <Input
              label="Price (₹)"
              type="number"
              min="0"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              helperText={
                form.price
                  ? `Formatted: ₹${new Intl.NumberFormat("en-IN").format(Number(form.price))}`
                  : undefined
              }
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text">
              Item description
            </label>
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-md border border-border bg-surface p-3 text-sm text-text placeholder:text-text-tertiary focus:border-primary focus:outline-hidden"
            />
          </div>

          <div>
            <Input
              label="Pickup area instructions"
              placeholder="e.g. Central Library 1st Floor, Hostel B Lounge"
              value={form.pickup_area}
              onChange={(e) => setForm({ ...form, pickup_area: e.target.value })}
              helperText="Only revealed to confirmed buyers."
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-text">
                  Item photos &amp; 3D studio
                </label>
                <p className="text-xs text-text-secondary">
                  Update angles or upload additional photos
                </p>
              </div>

              <div className="flex items-center rounded-md border border-border bg-surface-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setActivePhotoTab("3d")}
                  className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                    activePhotoTab === "3d"
                      ? "bg-surface text-text shadow-xs"
                      : "text-text-secondary hover:text-text"
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" strokeWidth={1.75} /> 3D studio
                </button>
                <button
                  type="button"
                  onClick={() => setActivePhotoTab("classic")}
                  className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                    activePhotoTab === "classic"
                      ? "bg-surface text-text shadow-xs"
                      : "text-text-secondary hover:text-text"
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" strokeWidth={1.75} /> Standard photos
                </button>
              </div>
            </div>

            {activePhotoTab === "3d" ? (
              <MultiAnglePhotoStudio
                initialPreviews={anglePreviews}
                onAnglesChange={(files, previews, ready) => {
                  setAngleFiles(files);
                  setAnglePreviews(previews);
                  setIs3DReady(ready);
                }}
                onError={(err) => setError(err)}
              />
            ) : (
              <div>
                <div className="mb-3 flex flex-wrap gap-2.5">
                  {existingImages.map((url, idx) => (
                    <div
                      key={idx}
                      className="relative h-20 w-20 overflow-hidden rounded-md border border-border bg-surface-muted"
                    >
                      <img
                        src={resolveImageUrl(url)}
                        alt={`Photo ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
                        Saved
                      </span>
                    </div>
                  ))}

                  {newPreviews.map((url, idx) => (
                    <div
                      key={idx}
                      className="relative h-20 w-20 overflow-hidden rounded-md border border-primary"
                    >
                      <img
                        src={url}
                        alt={`New upload ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveNewFile(idx)}
                        className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-on-primary hover:opacity-90"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}

                  {existingImages.length + newFiles.length < 5 && (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-20 w-20 flex-col items-center justify-center rounded-md border border-dashed border-border text-xs text-text-tertiary transition-colors hover:border-primary hover:text-primary"
                      >
                        <Upload className="h-4 w-4" strokeWidth={1.75} />
                        <span className="mt-1 text-[11px]">Add photo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCameraModal(true)}
                        className="flex h-20 w-20 flex-col items-center justify-center rounded-md border border-dashed border-primary/50 bg-primary-subtle/30 text-xs text-primary transition-colors hover:border-primary hover:bg-primary-subtle"
                      >
                        <Camera className="h-4 w-4" strokeWidth={1.75} />
                        <span className="mt-1 text-[11px]">Take photo</span>
                      </button>
                    </>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-border pt-4">
            <Link href={`/listings/${id}`}>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || uploadingImage}
            >
              <Save className="h-4 w-4" strokeWidth={1.75} />
              <span>
                {submitting || uploadingImage ? "Saving changes..." : "Save changes"}
              </span>
            </Button>
          </div>
        </form>
      </div>

      <CameraCaptureModal
        isOpen={showCameraModal}
        title="Take item photo"
        onCapture={(file) => addNewFiles([file])}
        onClose={() => setShowCameraModal(false)}
      />
    </div>
  );
}
