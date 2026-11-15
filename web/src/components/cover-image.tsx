import * as React from 'react'
import { ImageOff } from 'lucide-react'
import { cn, coverUrl } from '@/lib/utils'
import { useUiStore } from '@/store/ui'

type CoverImageProps = {
  token: string
  alt?: string
  className?: string
  imgClassName?: string
  full?: boolean
  fit?: 'cover' | 'contain'
  eager?: boolean
}

export function CoverImage({
  token,
  alt = '',
  className,
  imgClassName,
  full = false,
  fit = 'cover',
  eager = false,
}: CoverImageProps) {
  const coverRev = useUiStore(s => s.coverRev)
  const [failed, setFailed] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [token, full, coverRev])

  return (
    <div className={cn('relative overflow-hidden bg-[#070b10]', className)}>
      {!loaded && !failed ? <div className="ui-skeleton absolute inset-0" /> : null}
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,#142433,#0a1119_55%,#1b2d40)] text-[color:var(--subtle)]">
          <ImageOff className="size-5 opacity-60" />
        </div>
      ) : (
        <img
          src={`${coverUrl(token, full)}&c=${coverRev}`}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'h-full w-full transition-opacity duration-200',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            loaded ? 'opacity-100' : 'opacity-0',
            imgClassName,
          )}
        />
      )}
    </div>
  )
}
