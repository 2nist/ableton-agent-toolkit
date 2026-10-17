import { useSyncExternalStore } from "react";
import { getConfirmRequest, settleConfirm, subscribeConfirm } from "../../lib/confirm";
import Button from "./Button";
import Modal from "./Modal";

/** Mounted once by App; renders whatever `askConfirm()` is waiting on. */
export default function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, getConfirmRequest, () => null);

  return (
    <Modal
      open={request !== null}
      onClose={() => settleConfirm(false)}
      title={request?.title ?? "Confirm"}
      footer={
        <>
          <Button onClick={() => settleConfirm(false)}>
            {request?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={request?.danger ? "danger" : "primary"}
            data-autofocus
            onClick={() => settleConfirm(true)}
          >
            {request?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {request?.message}
    </Modal>
  );
}
