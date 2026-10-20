# Tienda BRELLOR

- `index.html`: la tienda pública (catálogo por secciones, carrito y pedidos).
- `admin.html`: el panel del dueño (inventario, fotos, precios, pedidos y ajustes).
- `supabase/setup.sql`: crea la base de datos, la carpeta de fotos y la seguridad.

## Para dejarla funcionando (una sola vez)

1. **Base de datos:** en Supabase entra a **SQL Editor > New query**. Abre `supabase/setup.sql`, cambia en la última línea `CORREO-DEL-DUENO@gmail.com` por el correo real del dueño, pega todo y dale **Run**.
2. **Usuario del dueño:** en Supabase ve a **Authentication > Users > Add user > Create new user**. Pon ese mismo correo y una contraseña, y marca **Auto Confirm User**.
3. **Cerrar registros:** en **Authentication > Sign In / Providers**, apaga **Allow new users to sign up**. Así nadie más puede crear cuentas.
4. **Publicar:** sube la carpeta a Vercel o Hostinger. El panel queda en `tu-dominio/admin.html`.
5. **WhatsApp:** entra al panel, en **Ajustes**, y pon el número de la tienda.

## Cómo funciona

- Al guardar una pieza en el panel, aparece en la tienda al instante. Las fotos se comprimen solas antes de subirse.
- Cuando un cliente confirma un pedido, las existencias bajan solas. Si se cancela el pedido, regresan.
- Con la llave pública no se puede modificar nada. Solo el correo registrado como administrador puede editar.

## Siguiente paso: cobro en línea

Cuando el dueño tenga su cuenta de Mercado Pago, se conecta el botón de pago al mismo pedido.
