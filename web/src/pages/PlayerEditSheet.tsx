import { useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import { useTranslation } from 'react-i18next';
import { usePlayerPhoto, useSavePlayer } from '../api/hooks';
import type { Player } from '../api/types';
import { Avatar } from '../components/cards';
import { IconCamera, IconTrash } from '../components/icons';
import { Button, Sheet, errorMessage, useToast } from '../components/ui';
import { cropToBlob, type CropArea } from '../lib/image';
import { POSITIONS } from '../lib/positions';

export default function PlayerEditSheet({ player, open, onClose }: { player: Player | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSavePlayer();
  const photo = usePlayerPhoto();
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [pos, setPos] = useState(4);
  const [active, setActive] = useState(true);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(player?.name ?? '');
    setShortName(player?.shortName ?? '');
    setPos(player?.preferredPosition ?? 4);
    setActive(player?.isActive ?? true);
    setSrc(null);
  }, [open, player]);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setSrc(String(reader.result));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    try {
      const saved = await save.mutateAsync({ id: player?.id, name: name.trim(), shortName: shortName.trim() || null, preferredPosition: pos, isActive: active });
      if (src && area) await photo.mutateAsync({ id: saved.id, blob: await cropToBlob(src, area) });
      toast(t('common.saved'));
      onClose();
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  };

  const removePhoto = () =>
    player && photo.mutate({ id: player.id, blob: null }, { onSuccess: () => toast(t('common.saved')), onError: (e) => toast(errorMessage(e, t), 'error') });

  const busy = save.isPending || photo.isPending;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={player ? t('players.edit') : t('players.add')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <span className="field-label">{t('players.photo')}</span>
          {src ? (
            <div className="flex flex-col gap-2">
              <div className="relative h-64 w-full bg-ink">
                <Cropper image={src} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, px) => setArea(px)} />
              </div>
              <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="zoom" className="!min-h-0 !border-0 !bg-transparent" />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Avatar player={player ?? { id: '', name: name || '?', shortName: null, photoUrl: null, preferredPosition: 4, isActive: true, createdAt: '' }} size={72} team="a" />
              <label className="btn btn-outline cursor-pointer">
                <IconCamera size={18} /> {t('players.upload')}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
              </label>
              {player?.photoUrl && (
                <Button variant="ghost" onClick={removePhoto} disabled={busy}>
                  <IconTrash size={18} /> {t('players.removePhoto')}
                </Button>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor="pl-name">{t('players.name')}</label>
          <input id="pl-name" className="w-full" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="field-label" htmlFor="pl-short">{t('players.shortName')}</label>
          <input id="pl-short" className="w-full" value={shortName} maxLength={12} onChange={(e) => setShortName(e.target.value)} autoComplete="off" />
          <p className="mt-1 text-caption text-fg-3">{t('players.shortNameHint')}</p>
        </div>
        <fieldset>
          <legend className="field-label">{t('players.preferred')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {POSITIONS.map((p) => (
              <button key={p} type="button" aria-pressed={pos === p} onClick={() => setPos(p)} className={`flex min-h-tap items-center gap-2 px-2 text-start font-semibold ${pos === p ? 'bg-ink text-on-ink' : 'bg-surface-2'}`}>
                <span className="num w-6 text-center font-extrabold">{p}</span>
                {t(`pos.${p}`)}
              </button>
            ))}
          </div>
        </fieldset>
        {player && (
          <label className="flex min-h-tap items-center gap-3 font-semibold">
            <input type="checkbox" className="!min-h-0 h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('players.active')}
          </label>
        )}
      </div>
    </Sheet>
  );
}
