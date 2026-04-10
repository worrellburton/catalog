import { useState, useCallback } from 'react';
import MediaUploader from './MediaUploader';
import type { ManagedLook, LookPhoto, LookVideo, CreateLookInput, UpdateLookInput, AddProductInput } from '~/services/manage-looks';
import {
  createLook,
  updateLook,
  uploadLookMedia,
  deleteMedia,
  addProductToLook,
  removeProductFromLook,
  submitLook,
  searchProducts,
  getLookDetail,
} from '~/services/manage-looks';

interface LookFormProps {
  look?: ManagedLook | null;
  onSaved: (look: ManagedLook) => void;
  onCancel: () => void;
}

interface UploadingFile {
  id: string;
  file: File;
  type: 'photo' | 'video';
  progress: 'pending' | 'uploading' | 'done' | 'error';
  previewUrl?: string;
}

export default function LookForm({ look, onSaved, onCancel }: LookFormProps) {
  const isEditing = !!look;

  const [title, setTitle] = useState(look?.title || '');
  const [description, setDescription] = useState(look?.description || '');
  const [gender, setGender] = useState<'men' | 'women' | 'unisex'>(look?.gender || 'unisex');
  const [color, setColor] = useState(look?.color || '#888888');

  const [photos, setPhotos] = useState<LookPhoto[]>(look?.look_photos || []);
  const [videos, setVideos] = useState<LookVideo[]>(look?.look_videos || []);
  const [products, setProducts] = useState(
    look?.look_products?.map(lp => lp.products) || []
  );

  const [uploadQueue, setUploadQueue] = useState<UploadingFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Product search
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<{ id: string; name: string; brand: string | null; price: string | null; url: string | null; image_url: string | null }[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);

  // New product form
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [newProduct, setNewProduct] = useState<AddProductInput>({ name: '', brand: '', price: '', url: '', image_url: '' });

  const [lookId, setLookId] = useState<string | null>(look?.id || null);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      let savedLook: ManagedLook;
      if (isEditing && lookId) {
        const input: UpdateLookInput = { title, description, gender, color };
        const res = await updateLook(lookId, input);
        savedLook = res.data;
      } else {
        const input: CreateLookInput = { title, description, gender, color };
        const res = await createLook(input);
        savedLook = res.data;
        setLookId(savedLook.id);
      }

      // Upload queued files
      let hasUploadErrors = false;
      const pendingUploads = uploadQueue.filter(q => q.progress !== 'done');

      if (pendingUploads.length > 0 && savedLook.id) {
        for (const item of pendingUploads) {
          setUploadQueue(prev =>
            prev.map(q => q.id === item.id ? { ...q, progress: 'uploading' as const } : q)
          );
          try {
            const result = await uploadLookMedia(savedLook.id, item.file, item.type);
            setUploadQueue(prev =>
              prev.map(q => q.id === item.id ? { ...q, progress: 'done' as const } : q)
            );
            if (item.type === 'photo') {
              setPhotos(prev => [...prev, {
                id: crypto.randomUUID(),
                order_index: prev.length,
                storage_path: result.storagePath,
                url: result.publicUrl,
                thumbnail_url: result.publicUrl,
                transform: null,
              }]);
            } else {
              setVideos(prev => [...prev, {
                id: crypto.randomUUID(),
                order_index: prev.length,
                storage_path: result.storagePath,
                url: result.publicUrl,
                poster_url: result.publicUrl,
                duration_seconds: null,
              }]);
            }
          } catch (err) {
            hasUploadErrors = true;
            setUploadQueue(prev =>
              prev.map(q => q.id === item.id ? { ...q, progress: 'error' as const } : q)
            );
          }
        }
        // Clear completed uploads
        setUploadQueue(prev => prev.filter(q => q.progress !== 'done'));
      }

      if (hasUploadErrors) {
        setError('Some media failed to upload. You can retry or remove failed items and save again.');
        return;
      }

      // Re-fetch look detail to get fresh data with media
      if (pendingUploads.length > 0 && savedLook.id) {
        try {
          const res = await getLookDetail(savedLook.id);
          savedLook = res.data;
        } catch {
          // Non-critical — parent will re-fetch list anyway
        }
      }

      onSaved(savedLook);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [title, description, gender, color, isEditing, lookId, uploadQueue, onSaved]);

  const handleSubmitForReview = useCallback(async () => {
    if (!lookId) return;
    setSubmitting(true);
    setError(null);
    try {
      // Save first
      await handleSave();
      const res = await submitLook(lookId);
      onSaved(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }, [lookId, handleSave, onSaved]);

  const handleFilesSelected = useCallback((files: File[]) => {
    const newItems: UploadingFile[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      type: file.type.startsWith('video/') ? 'video' : 'photo',
      progress: 'pending',
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setUploadQueue(prev => [...prev, ...newItems]);
  }, []);

  const handleRemoveQueued = useCallback((id: string) => {
    setUploadQueue(prev => {
      const item = prev.find(q => q.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(q => q.id !== id);
    });
  }, []);

  const handleDeletePhoto = useCallback(async (photoId: string) => {
    if (!lookId) return;
    try {
      await deleteMedia(lookId, 'photo', photoId);
      setPhotos(prev => prev.filter(p => p.id !== photoId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [lookId]);

  const handleDeleteVideo = useCallback(async (videoId: string) => {
    if (!lookId) return;
    try {
      await deleteMedia(lookId, 'video', videoId);
      setVideos(prev => prev.filter(v => v.id !== videoId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [lookId]);

  const handleProductSearch = useCallback(async (query: string) => {
    setProductSearch(query);
    if (query.length < 2) { setProductResults([]); return; }
    const results = await searchProducts(query);
    setProductResults(results);
  }, []);

  const handleAddExistingProduct = useCallback(async (productId: string) => {
    if (!lookId) {
      setError('Save the look first before adding products');
      return;
    }
    try {
      await addProductToLook(lookId, { product_id: productId });
      const product = productResults.find(p => p.id === productId);
      if (product) {
        setProducts(prev => [...prev, product]);
      }
      setProductSearch('');
      setProductResults([]);
      setShowProductSearch(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add product');
    }
  }, [lookId, productResults]);

  const handleAddNewProduct = useCallback(async () => {
    if (!lookId) {
      setError('Save the look first before adding products');
      return;
    }
    if (!newProduct.name?.trim()) {
      setError('Product name is required');
      return;
    }
    try {
      const res = await addProductToLook(lookId, newProduct);
      setProducts(prev => [...prev, {
        id: res.data.product_id,
        name: newProduct.name || '',
        brand: newProduct.brand || null,
        price: newProduct.price || null,
        url: newProduct.url || null,
        image_url: newProduct.image_url || null,
      }]);
      setNewProduct({ name: '', brand: '', price: '', url: '', image_url: '' });
      setShowNewProduct(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add product');
    }
  }, [lookId, newProduct]);

  const handleRemoveProduct = useCallback(async (productId: string) => {
    if (!lookId) return;
    try {
      await removeProductFromLook(lookId, productId);
      setProducts(prev => prev.filter(p => p.id !== productId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove product');
    }
  }, [lookId]);

  const mediaCount = photos.length + videos.length + uploadQueue.length;

  return (
    <div className="look-form">
      <div className="look-form-header">
        <h2>{isEditing ? 'Edit Look' : 'Create New Look'}</h2>
        <button className="look-form-close" onClick={onCancel} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {error && <div className="look-form-error">{error}</div>}

      <div className="look-form-body">
        {/* Title & Description */}
        <div className="look-form-section">
          <label className="look-form-label">Title *</label>
          <input
            type="text"
            className="look-form-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Give your look a title"
            maxLength={100}
          />
        </div>

        <div className="look-form-section">
          <label className="look-form-label">Description</label>
          <textarea
            className="look-form-textarea"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe your look..."
            rows={3}
            maxLength={500}
          />
        </div>

        {/* Gender & Color */}
        <div className="look-form-row">
          <div className="look-form-section look-form-half">
            <label className="look-form-label">Category</label>
            <div className="look-form-chips">
              {(['men', 'women', 'unisex'] as const).map(g => (
                <button
                  key={g}
                  className={`look-form-chip ${gender === g ? 'active' : ''}`}
                  onClick={() => setGender(g)}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="look-form-section look-form-half">
            <label className="look-form-label">Color</label>
            <div className="look-form-color-wrap">
              <input
                type="color"
                className="look-form-color"
                value={color}
                onChange={e => setColor(e.target.value)}
              />
              <span className="look-form-color-value">{color}</span>
            </div>
          </div>
        </div>

        {/* Media Upload */}
        <div className="look-form-section">
          <label className="look-form-label">Media ({mediaCount})</label>

          {/* Existing photos */}
          {(photos.length > 0 || videos.length > 0 || uploadQueue.length > 0) && (
            <div className="look-form-media-grid">
              {photos.map(photo => (
                <div key={photo.id} className="look-form-media-item">
                  <img src={photo.thumbnail_url || photo.url || ''} alt="" />
                  <button className="look-form-media-delete" onClick={() => handleDeletePhoto(photo.id)} aria-label="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                  <span className="look-form-media-badge">Photo</span>
                </div>
              ))}
              {videos.map(video => (
                <div key={video.id} className="look-form-media-item">
                  {video.poster_url ? (
                    <img src={video.poster_url} alt="" />
                  ) : (
                    <div className="look-form-media-placeholder">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </div>
                  )}
                  <button className="look-form-media-delete" onClick={() => handleDeleteVideo(video.id)} aria-label="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                  <span className="look-form-media-badge">Video</span>
                </div>
              ))}
              {uploadQueue.map(item => (
                <div key={item.id} className={`look-form-media-item ${item.progress === 'uploading' ? 'uploading' : ''} ${item.progress === 'error' ? 'errored' : ''}`}>
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" />
                  ) : (
                    <div className="look-form-media-placeholder">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </div>
                  )}
                  <button className="look-form-media-delete" onClick={() => handleRemoveQueued(item.id)} aria-label="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                  {item.progress === 'uploading' && <div className="look-form-media-spinner" />}
                  {item.progress === 'error' && <span className="look-form-media-badge error">Failed</span>}
                  {item.progress === 'pending' && <span className="look-form-media-badge pending">Pending</span>}
                </div>
              ))}
            </div>
          )}

          <MediaUploader
            onFilesSelected={handleFilesSelected}
            disabled={saving}
          />
        </div>

        {/* Products */}
        <div className="look-form-section">
          <div className="look-form-section-header">
            <label className="look-form-label">Tagged Products ({products.length})</label>
            <div className="look-form-product-actions">
              <button className="look-form-btn-sm" onClick={() => { setShowProductSearch(true); setShowNewProduct(false); }}>
                Search Product
              </button>
              <button className="look-form-btn-sm" onClick={() => { setShowNewProduct(true); setShowProductSearch(false); }}>
                Add New
              </button>
            </div>
          </div>

          {/* Product search */}
          {showProductSearch && (
            <div className="look-form-product-search">
              <input
                type="text"
                className="look-form-input"
                value={productSearch}
                onChange={e => handleProductSearch(e.target.value)}
                placeholder="Search products by name..."
                autoFocus
              />
              {productResults.length > 0 && (
                <div className="look-form-product-results">
                  {productResults.map(p => (
                    <button key={p.id} className="look-form-product-result" onClick={() => handleAddExistingProduct(p.id)}>
                      {p.image_url && <img src={p.image_url} alt="" className="look-form-product-thumb" />}
                      <div>
                        <div className="look-form-product-name">{p.name}</div>
                        {p.brand && <div className="look-form-product-brand">{p.brand} {p.price && `· ${p.price}`}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button className="look-form-btn-text" onClick={() => setShowProductSearch(false)}>Cancel</button>
            </div>
          )}

          {/* New product form */}
          {showNewProduct && (
            <div className="look-form-new-product">
              <input type="text" className="look-form-input" placeholder="Product name *" value={newProduct.name} onChange={e => setNewProduct(prev => ({ ...prev, name: e.target.value }))} />
              <div className="look-form-row">
                <input type="text" className="look-form-input" placeholder="Brand" value={newProduct.brand} onChange={e => setNewProduct(prev => ({ ...prev, brand: e.target.value }))} />
                <input type="text" className="look-form-input" placeholder="Price" value={newProduct.price} onChange={e => setNewProduct(prev => ({ ...prev, price: e.target.value }))} />
              </div>
              <input type="url" className="look-form-input" placeholder="Product URL" value={newProduct.url} onChange={e => setNewProduct(prev => ({ ...prev, url: e.target.value }))} />
              <div className="look-form-row">
                <button className="look-form-btn-primary" onClick={handleAddNewProduct}>Add Product</button>
                <button className="look-form-btn-text" onClick={() => setShowNewProduct(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Product list */}
          {products.length > 0 && (
            <div className="look-form-product-list">
              {products.map(p => (
                <div key={p.id} className="look-form-product-item">
                  {p.image_url && <img src={p.image_url} alt="" className="look-form-product-thumb" />}
                  <div className="look-form-product-info">
                    <div className="look-form-product-name">{p.name}</div>
                    {p.brand && <div className="look-form-product-brand">{p.brand} {p.price && `· ${p.price}`}</div>}
                  </div>
                  <button className="look-form-product-remove" onClick={() => handleRemoveProduct(p.id)} aria-label="Remove product">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="look-form-actions">
        <button className="look-form-btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className="look-form-btn-primary" onClick={handleSave} disabled={saving || !title.trim()}>
          {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Save Draft'}
        </button>
        {(isEditing || lookId) && look?.status === 'draft' && (
          <button className="look-form-btn-submit" onClick={handleSubmitForReview} disabled={submitting || saving}>
            {submitting ? 'Submitting...' : 'Submit for Review'}
          </button>
        )}
      </div>
    </div>
  );
}
