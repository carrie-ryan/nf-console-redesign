/** A stylesheet imported as text (`import css from '…/styles.css' with { loader: 'text' }`) — specs only. */
declare module '*.css' {
  const text: string;
  export default text;
}
